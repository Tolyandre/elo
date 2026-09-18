package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Tournament brackets (ADR-26). The service owns the lifecycle: registration
// (strict participant list + game pool with table capacities), the single
// start action (validate the chosen plan against a fresh enumeration, store
// it verbatim, materialize rounds/slots/seats with a seeded draw, create the
// tournament arena), and the read side (bracket DTO). Slot play — acceptance,
// points, rulings, cascades — lives in slotplay.go.

// Lifecycle states (tournaments.status).
const (
	TournamentRegistration = "registration"
	TournamentRunning      = "running"
	TournamentCompleted    = "completed"
	TournamentCancelled    = "cancelled"
)

// Elimination families (tournaments.elimination).
const (
	TournamentSingle = bracket.EliminationSingle
	TournamentDouble = bracket.EliminationDouble
)

type TournamentService struct {
	Pool    *pgxpool.Pool
	Queries *db.Queries
	Arenas  *ArenaService
}

func NewTournamentService(pool *pgxpool.Pool, arenas *ArenaService) *TournamentService {
	return &TournamentService{Pool: pool, Queries: db.New(pool), Arenas: arenas}
}

// TournamentGameInput is one pool entry of a create/update request.
type TournamentGameInput struct {
	GameID id.ID
	Min    int
	Max    int
}

// TournamentWriteOpts carries the registration-time configuration.
// On update, nil Games / nil ParticipantIDs keep the stored set (the PUT body
// marks them "when present"); a nil GrandFinalDeadline clears it.
type TournamentWriteOpts struct {
	Name               string
	Elimination        string
	GrandFinalDeadline *time.Time
	Games              []TournamentGameInput
	ParticipantIDs     []id.ID
	ActorUserID        id.ID
}

// CreateTournament inserts the entity in the registration state. The client
// supplied id (ADR-06) is the idempotency key: a replay returns the stored
// row. The game pool and the initial participants are written in the same
// transaction; everything is audit-logged as tournament-config.
func (s *TournamentService) CreateTournament(ctx context.Context, tid id.ID, opts TournamentWriteOpts) (db.Tournament, error) {
	if err := validateTournamentInput(opts); err != nil {
		return db.Tournament{}, err
	}
	if !tid.IsZero() {
		// Idempotent create: an id replay returns the already-created row.
		existing, err := s.Queries.GetTournament(ctx, tid)
		if err == nil {
			return existing, nil
		}
		if !db.IsNoRows(err) {
			return db.Tournament{}, fmt.Errorf("get tournament: %w", err)
		}
	} else {
		tid = id.New()
	}

	if _, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (db.Tournament, error) {
		row, err := q.CreateTournament(ctx, db.CreateTournamentParams{
			ID:                 tid,
			Name:               opts.Name,
			Elimination:        opts.Elimination,
			GrandFinalDeadline: timePtrTz(opts.GrandFinalDeadline),
		})
		if db.IsNoRows(err) {
			// Same id raced in first — the replay semantics return it.
			return q.GetTournament(ctx, tid)
		}
		if err != nil {
			return db.Tournament{}, fmt.Errorf("create tournament: %w", err)
		}
		if err := writeTournamentPool(ctx, q, tid, opts.Games); err != nil {
			return db.Tournament{}, err
		}
		if err := writeTournamentParticipants(ctx, q, tid, opts.ParticipantIDs); err != nil {
			return db.Tournament{}, err
		}
		deadline := (*time.Time)(nil)
		if opts.GrandFinalDeadline != nil {
			deadline = opts.GrandFinalDeadline
		}
		if err := recordAuditEvent(ctx, q, opts.ActorUserID, audit.EntityTournament, audit.ActionCreated, tid,
			audit.KindTournamentConfig, audit.NewTournamentConfigCreated(
				opts.Name, deadline, tournamentGameDocsOf(opts.Games), idStrings(opts.ParticipantIDs))); err != nil {
			return db.Tournament{}, err
		}
		return row, nil
	}); err != nil {
		return db.Tournament{}, err
	}
	return s.Queries.GetTournament(ctx, tid)
}

// UpdateTournament rewrites the registration-time configuration. Only while
// the tournament is in registration; every changed field is audited as a
// full before → after in one tournament-config row.
func (s *TournamentService) UpdateTournament(ctx context.Context, tid id.ID, opts TournamentWriteOpts) (db.Tournament, error) {
	if err := validateTournamentInput(opts); err != nil {
		return db.Tournament{}, err
	}
	if _, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (struct{}, error) {
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return struct{}{}, fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration {
			return struct{}{}, ErrTournamentNotEditable
		}

		beforeGames, err := q.ListTournamentGames(ctx, tid)
		if err != nil {
			return struct{}{}, fmt.Errorf("list pool: %w", err)
		}
		beforeParticipants, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return struct{}{}, err
		}

		if err := q.UpdateTournamentConfig(ctx, db.UpdateTournamentConfigParams{
			ID:                 tid,
			Name:               opts.Name,
			GrandFinalDeadline: timePtrTz(opts.GrandFinalDeadline),
		}); err != nil {
			return struct{}{}, fmt.Errorf("update tournament: %w", err)
		}

		if opts.Games != nil {
			if err := writeTournamentPool(ctx, q, tid, opts.Games); err != nil {
				return struct{}{}, err
			}
		}
		if opts.ParticipantIDs != nil {
			if err := writeTournamentParticipants(ctx, q, tid, opts.ParticipantIDs); err != nil {
				return struct{}{}, err
			}
		}

		afterGames, err := q.ListTournamentGames(ctx, tid)
		if err != nil {
			return struct{}{}, fmt.Errorf("list pool: %w", err)
		}
		afterParticipants, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return struct{}{}, err
		}

		// One config row with the changed fields' full before → after; a
		// no-op update emits nothing (ADR-14).
		details := audit.TournamentConfigDetails{SchemaVersion: 1}
		if t.Name != opts.Name {
			old, new := t.Name, opts.Name
			details.Name = valueChangeStr(&old, &new)
		}
		oldDeadline, newDeadline := tzTimePtr(t.GrandFinalDeadline), opts.GrandFinalDeadline
		if !timePtrEqual(oldDeadline, newDeadline) {
			details.GrandFinalDeadline = valueChangeStr(timeStrPtr(oldDeadline), timeStrPtr(newDeadline))
		}
		if opts.Games != nil && !poolEqual(beforeGames, afterGames) {
			details.Games = &audit.GamesChange{
				From: tournamentGameDocsOfRows(beforeGames),
				To:   tournamentGameDocsOfRows(afterGames),
			}
		}
		if opts.ParticipantIDs != nil && !idListEqual(beforeParticipants, afterParticipants) {
			details.FromPlayerIDs = idStrings(beforeParticipants)
			details.ToPlayerIDs = idStrings(afterParticipants)
		}
		if details.Name != nil || details.GrandFinalDeadline != nil || details.Games != nil || details.FromPlayerIDs != nil || details.ToPlayerIDs != nil {
			if err := recordAuditEvent(ctx, q, opts.ActorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
				audit.KindTournamentConfig, details); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	}); err != nil {
		return db.Tournament{}, err
	}
	return s.Queries.GetTournament(ctx, tid)
}

// Register adds the caller's linked player to the participant list; only in
// the registration state, idempotent, audited when it changes anything.
func (s *TournamentService) Register(ctx context.Context, tid, playerID, actorUserID id.ID) error {
	return s.ChangeRegistration(ctx, tid, playerID, actorUserID, true)
}

// Unregister withdraws the caller's linked player.
func (s *TournamentService) Unregister(ctx context.Context, tid, playerID, actorUserID id.ID) error {
	return s.ChangeRegistration(ctx, tid, playerID, actorUserID, false)
}

// ChangeRegistration is the shared join/withdraw path.
func (s *TournamentService) ChangeRegistration(ctx context.Context, tid, playerID, actorUserID id.ID, join bool) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration {
			return ErrTournamentNotOpenForRegistration
		}
		before, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return err
		}
		if join {
			if err := q.AddTournamentParticipant(ctx, db.AddTournamentParticipantParams{
				TournamentID: tid, PlayerID: playerID,
			}); err != nil {
				return fmt.Errorf("register player: %w", err)
			}
		} else {
			if err := q.RemoveTournamentParticipant(ctx, db.RemoveTournamentParticipantParams{
				TournamentID: tid, PlayerID: playerID,
			}); err != nil {
				return fmt.Errorf("withdraw player: %w", err)
			}
		}
		after, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return err
		}
		if idListEqual(before, after) {
			return nil // idempotent replay — no audit row (ADR-14)
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindTournamentConfig, audit.TournamentConfigDetails{
				SchemaVersion: 1,
				FromPlayerIDs: idStrings(before),
				ToPlayerIDs:   idStrings(after),
			})
	})
}

// ListBracketPlans enumerates the valid shapes for the current participant
// count, pool and elimination family — a pure function, nothing stored
// (ADR-26). Only meaningful in registration; the start action validates the
// organizer's pick against a fresh run of the same enumeration.
func (s *TournamentService) ListBracketPlans(ctx context.Context, tid id.ID) (bracket.Result, error) {
	t, err := s.Queries.GetTournament(ctx, tid)
	if err != nil {
		return bracket.Result{}, fmt.Errorf("get tournament: %w", err)
	}
	if t.Status != TournamentRegistration {
		return bracket.Result{}, ErrTournamentNotEditable
	}
	n, err := s.Queries.CountTournamentParticipants(ctx, tid)
	if err != nil {
		return bracket.Result{}, fmt.Errorf("count participants: %w", err)
	}
	if n < 2 {
		return bracket.Result{}, ErrTournamentTooFewParticipants
	}
	pool, err := s.Queries.ListTournamentGames(ctx, tid)
	if err != nil {
		return bracket.Result{}, fmt.Errorf("list pool: %w", err)
	}
	if len(pool) == 0 {
		return bracket.Result{}, ErrTournamentPoolEmpty
	}
	return bracket.Enumerate(int(n), poolCaps(pool), t.Elimination, bracket.DefaultPlanCap), nil
}

// ListTournaments is the /tournaments list read (status-ordered by the query).
func (s *TournamentService) ListTournaments(ctx context.Context) ([]db.Tournament, error) {
	return s.Queries.ListTournaments(ctx)
}

// TournamentDetail is the single-tournament read: the row plus its pool and
// participant ids. A nil Participants slice marks list reads (the field is
// omitted from the payload).
type TournamentDetail struct {
	Row          db.Tournament
	Games        []db.TournamentGame
	Participants []id.ID
}

// GetTournamentDetail is the single-tournament read.
func (s *TournamentService) GetTournamentDetail(ctx context.Context, tid id.ID) (TournamentDetail, error) {
	t, err := s.Queries.GetTournament(ctx, tid)
	if err != nil {
		return TournamentDetail{}, fmt.Errorf("get tournament: %w", err)
	}
	games, err := s.Queries.ListTournamentGames(ctx, tid)
	if err != nil {
		return TournamentDetail{}, fmt.Errorf("list pool: %w", err)
	}
	participants, err := tournamentParticipantIDs(ctx, s.Queries, tid)
	if err != nil {
		return TournamentDetail{}, err
	}
	return TournamentDetail{Row: t, Games: games, Participants: participants}, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func validateTournamentInput(opts TournamentWriteOpts) error {
	if opts.Name == "" {
		return ErrTournamentNameRequired
	}
	if opts.Elimination != TournamentSingle && opts.Elimination != TournamentDouble {
		return ErrTournamentEliminationInvalid
	}
	if opts.GrandFinalDeadline != nil && !opts.GrandFinalDeadline.After(time.Now()) {
		return ErrTournamentDeadlineInvalid
	}
	for _, g := range opts.Games {
		if g.Min < 2 || g.Max < g.Min {
			return ErrTournamentPoolEntryInvalid
		}
	}
	return nil
}

// writeTournamentPool rewrites the game pool wholesale (the table is small
// and the caller holds the tournament row lock). Foreign keys surface unknown
// games as clean 400s.
func writeTournamentPool(ctx context.Context, q *db.Queries, tid id.ID, games []TournamentGameInput) error {
	if err := q.DeleteTournamentGames(ctx, tid); err != nil {
		return fmt.Errorf("clear pool: %w", err)
	}
	for _, g := range games {
		if g.Min < 2 || g.Max < g.Min {
			return ErrTournamentPoolEntryInvalid
		}
		if err := q.AddTournamentGame(ctx, db.AddTournamentGameParams{
			TournamentID: tid, GameID: g.GameID, MinPlayers: int32(g.Min), MaxPlayers: int32(g.Max),
		}); err != nil {
			return fmt.Errorf("add pool game: %w", err)
		}
	}
	return nil
}

// writeTournamentParticipants applies the desired participant set.
func writeTournamentParticipants(ctx context.Context, q *db.Queries, tid id.ID, wanted []id.ID) error {
	if err := q.DeleteTournamentParticipantsNotIn(ctx, db.DeleteTournamentParticipantsNotInParams{
		TournamentID: tid,
		PlayerIds:    wanted,
	}); err != nil {
		return fmt.Errorf("drop participants: %w", err)
	}
	for _, pid := range wanted {
		if err := q.AddTournamentParticipant(ctx, db.AddTournamentParticipantParams{
			TournamentID: tid, PlayerID: pid,
		}); err != nil {
			return fmt.Errorf("add participant: %w", err)
		}
	}
	return nil
}

func tournamentParticipantIDs(ctx context.Context, q *db.Queries, tid id.ID) ([]id.ID, error) {
	rows, err := q.ListTournamentParticipants(ctx, tid)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	out := make([]id.ID, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.PlayerID)
	}
	return out, nil
}

func poolCaps(pool []db.TournamentGame) []bracket.GameCapacity {
	out := make([]bracket.GameCapacity, 0, len(pool))
	for _, g := range pool {
		out = append(out, bracket.GameCapacity{Min: int(g.MinPlayers), Max: int(g.MaxPlayers)})
	}
	return out
}

func tournamentGameDocsOf(games []TournamentGameInput) []audit.TournamentGameDoc {
	out := make([]audit.TournamentGameDoc, 0, len(games))
	for _, g := range games {
		out = append(out, audit.TournamentGameDoc{GameID: string(g.GameID), MinPlayers: g.Min, MaxPlayers: g.Max})
	}
	return out
}

func tournamentGameDocsOfRows(games []db.TournamentGame) []audit.TournamentGameDoc {
	out := make([]audit.TournamentGameDoc, 0, len(games))
	for _, g := range games {
		out = append(out, audit.TournamentGameDoc{
			GameID: string(g.GameID), MinPlayers: int(g.MinPlayers), MaxPlayers: int(g.MaxPlayers),
		})
	}
	return out
}

func poolEqual(a, b []db.TournamentGame) bool {
	if len(a) != len(b) {
		return false
	}
	key := func(g db.TournamentGame) string {
		return fmt.Sprintf("%s:%d:%d", g.GameID, g.MinPlayers, g.MaxPlayers)
	}
	seen := make(map[string]int, len(a))
	for _, g := range a {
		seen[key(g)]++
	}
	for _, g := range b {
		seen[key(g)]--
	}
	for _, v := range seen {
		if v != 0 {
			return false
		}
	}
	return true
}

func idListEqual(a, b []id.ID) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[id.ID]int, len(a))
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
	}
	for _, v := range seen {
		if v != 0 {
			return false
		}
	}
	return true
}

func idStrings(ids []id.ID) []string {
	out := make([]string, 0, len(ids))
	for _, v := range ids {
		out = append(out, string(v))
	}
	return out
}

func valueChangeStr(from, to *string) *audit.ValueChange {
	return &audit.ValueChange{From: from, To: to}
}

func tzTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func timeStrPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339Nano)
	return &s
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}
