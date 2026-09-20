package elo

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
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

// Elimination families (tournaments.elimination) — chosen with the bracket
// plan at start, not at creation (the column stays NULL during registration).
const (
	TournamentSingle = bracket.EliminationSingle
	TournamentDouble = bracket.EliminationDouble
)

// Canonical track ordering (winners before losers before final) — mirrors the
// SQL CASE in tournament_brackets.sql and pkg/bracket's trackRank.
var (
	tournamentTrackRank  = map[string]int{bracket.TrackWinners: 0, bracket.TrackLosers: 1, bracket.TrackFinal: 2}
	tournamentTrackNames = [3]string{bracket.TrackWinners, bracket.TrackLosers, bracket.TrackFinal}
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
// ListBracketPlans enumerates the valid plans for the current participant
// count and pool. The filter carries the shape picker's chip selection: the
// families to explore (empty = both) plus the display filters applied before
// the cap — the response is always the first DefaultPlanCap plans of the
// current condition.
func (s *TournamentService) ListBracketPlans(ctx context.Context, tid id.ID, filter bracket.PlanFilter) (bracket.Result, error) {
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
	return bracket.EnumerateFiltered(int(n), poolCaps(pool), filter, bracket.DefaultPlanCap), nil
}

// ListTournaments is the /tournaments list read (status-ordered by the query),
// each row carrying its participants in registration order (the list shows
// the count).
func (s *TournamentService) ListTournaments(ctx context.Context) ([]TournamentDetail, error) {
	rows, err := s.Queries.ListTournaments(ctx)
	if err != nil {
		return nil, fmt.Errorf("list tournaments: %w", err)
	}
	out := make([]TournamentDetail, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]id.ID, 0, len(rows))
	for _, t := range rows {
		ids = append(ids, t.ID)
	}
	participants, err := s.Queries.ListParticipantsOfTournaments(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list participants: %w", err)
	}
	byTournament := make(map[id.ID][]id.ID, len(rows))
	for _, p := range participants {
		byTournament[p.TournamentID] = append(byTournament[p.TournamentID], p.PlayerID)
	}
	for _, t := range rows {
		out = append(out, TournamentDetail{Row: t, Participants: byTournament[t.ID]})
	}
	return out, nil
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

// ---------------------------------------------------------------------------
// Start, cancel, bracket (ADR-26 §Start / §Lifecycle)
// ---------------------------------------------------------------------------

// Slot statuses (tournament_slots.status).
const (
	TournamentSlotWaiting   = "waiting"
	TournamentSlotPlaying   = "playing"
	TournamentSlotCompleted = "completed"
)

// StartTournament validates the submitted plan against a fresh enumeration,
// stores it verbatim, generates all rounds/slots/seats with a seeded draw,
// creates the tournament arena, and flips the lifecycle to running — one
// transaction.
func (s *TournamentService) StartTournament(ctx context.Context, tid id.ID, planRaw json.RawMessage, actorUserID id.ID) error {
	plan, err := bracket.ParsePlan(planRaw)
	if err != nil {
		return err
	}
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration {
			return ErrTournamentAlreadyStarted
		}
		if t.GrandFinalDeadline.Valid && !t.GrandFinalDeadline.Time.After(time.Now()) {
			return ErrTournamentDeadlineInvalid
		}
		participants, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return err
		}
		if len(participants) < 2 {
			return ErrTournamentTooFewParticipants
		}
		pool, err := q.ListTournamentGames(ctx, tid)
		if err != nil {
			return fmt.Errorf("list pool: %w", err)
		}
		if len(pool) == 0 {
			return ErrTournamentPoolEmpty
		}

		// The submitted plan must be one the server would have offered — no
		// hand-forged structures (ADR-26). The shape-picker list applies its
		// cap after the display filters, so an offered plan can rank beyond
		// the unfiltered head; OffersPlan searches the whole enumeration
		// instead of a capped prefix.
		if !bracket.OffersPlan(len(participants), poolCaps(pool), plan.Elimination, plan) {
			return ErrTournamentPlanInvalid
		}
		canonical := plan.CanonicalJSON()

		// Seeded draw: participants sorted by id, Fisher–Yates from the stored
		// seed — the same inputs always reproduce the same bracket.
		seed := randomSeed()
		rng := rand.New(rand.NewSource(seed))
		draw := slices.Clone(participants)
		slices.Sort(draw)
		rng.Shuffle(len(draw), func(i, j int) { draw[i], draw[j] = draw[j], draw[i] })
		cursor := 0
		takeDrawn := func() (id.ID, error) {
			if cursor >= len(draw) {
				// Unreachable for an offered plan: draw + bye seats number
				// exactly the participant count (bye seats are the round-1
				// remainder; a waiting survivor is a source seat). Kept as a
				// guard so a future invariant slip fails the start instead of
				// panicking.
				return id.ID(""), ErrTournamentPlanInvalid
			}
			p := draw[cursor]
			cursor++
			return p, nil
		}

		// Materialize: rounds/slots/seats in canonical plan order. Draw and
		// bye seats take the next drawn players directly (round-1 tables
		// first, then the bye seats — byes are the round-1 remainder, emitted
		// at the tail); source seats stay unresolved until their source slot
		// completes.
		fitting := fittingGames(pool)
		slotIDs := make(map[int]id.ID) // flat plan slot index → slot row id
		flat := 0
		for roundPos, pr := range plan.Rounds {
			roundID := id.New()
			if _, err := q.CreateTournamentRound(ctx, db.CreateTournamentRoundParams{
				ID: roundID, TournamentID: tid, Track: pr.Track, Index: int32(pr.Index),
			}); err != nil {
				return fmt.Errorf("create round: %w", err)
			}
			for slotPos, ps := range pr.Slots {
				game := pickGame(rng, fitting[ps.SeatCount])
				slotID := id.New()
				status := TournamentSlotWaiting
				if roundPos == 0 {
					status = TournamentSlotPlaying
				}
				if _, err := q.CreateTournamentSlot(ctx, db.CreateTournamentSlotParams{
					ID: slotID, RoundID: roundID, Position: int32(slotPos + 1),
					GameID: game, Promote: int32(pr.Promote), Status: status,
				}); err != nil {
					return fmt.Errorf("create slot: %w", err)
				}
				slotIDs[flat] = slotID
				flat++
				for seatPos, seat := range ps.Seats {
					var playerID *id.ID
					if seat.Kind == bracket.SeatDraw || seat.Kind == bracket.SeatBye {
						p, err := takeDrawn()
						if err != nil {
							return err
						}
						playerID = &p
					}
					var sourceSlotID *id.ID
					if seat.Kind == bracket.SeatSource {
						slot := 0
						if seat.SourceSlot != nil {
							slot = *seat.SourceSlot
						}
						sid := slotIDs[slot]
						sourceSlotID = &sid
					}
					var sourcePlace pgtype.Int4
					if seat.Kind == bracket.SeatSource {
						sourcePlace = pgtype.Int4{Int32: int32(seat.SourcePlace), Valid: true}
					}
					if err := q.CreateTournamentSeat(ctx, db.CreateTournamentSeatParams{
						ID: id.New(), SlotID: slotID, Position: int32(seatPos + 1),
						PlayerID: playerID, SourceSlotID: sourceSlotID, SourcePlace: sourcePlace,
					}); err != nil {
						return fmt.Errorf("create seat: %w", err)
					}
				}
			}
		}

		// The tournament arena (ADR-24 anchor, no filter, no leagues) —
		// rating, medals and the standings table come for free through the
		// arena pipeline.
		if err := s.ensureTournamentArena(ctx, q, tid, t.Name); err != nil {
			return err
		}

		if err := q.SetTournamentRunning(ctx, db.SetTournamentRunningParams{
			ID: tid, Seed: pgtype.Int8{Int64: seed, Valid: true}, Plan: []byte(canonical), PlanSchemaVersion: 1,
			Elimination: pgtype.Text{String: plan.Elimination, Valid: true},
		}); err != nil {
			return fmt.Errorf("set running: %w", err)
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindTournamentStart, audit.NewTournamentStartDetails([]byte(canonical), seed, idStrings(participants)))
	})
}

// CancelTournament aborts the tournament from registration or running (the
// organizer action; the grand-final deadline auto-cancel in slotplay.go
// shares the state write with reason "deadline").
func (s *TournamentService) CancelTournament(ctx context.Context, tid, actorUserID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration && t.Status != TournamentRunning {
			return ErrTournamentLifecycleInvalid
		}
		if err := q.SetTournamentStatus(ctx, db.SetTournamentStatusParams{ID: tid, Status: TournamentCancelled}); err != nil {
			return fmt.Errorf("cancel: %w", err)
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindTournamentState, audit.NewTournamentStateDetails(t.Status, TournamentCancelled, audit.StateReasonOrganizer))
	})
}

// BracketSeat is one seat of the bracket DTO.
type BracketSeat struct {
	Position     int
	PlayerID     *id.ID
	SourceSlotID *id.ID
	SourcePlace  *int
}

// BracketSlot is one rendered table of the bracket DTO.
type BracketSlot struct {
	ID        id.ID
	Position  int
	GameID    id.ID
	Promote   int
	Status    string
	Seats     []BracketSeat
	MatchIDs  []id.ID
	Standings []bracket.Standing
	// Ruling is the organizer ruling in force, ordered by place; nil when the
	// outcome comes from the standings.
	Ruling []id.ID
}

// BracketRound is one round of the bracket DTO.
type BracketRound struct {
	Track string
	Index int
	Slots []BracketSlot
}

// GetBracket assembles the full bracket DTO: the stored structure plus live
// standings derived from the linked matches' scores — standings are never
// stored (ADR-26). The lazy deadline check corrects a stale running status;
// the read never fails on it.
func (s *TournamentService) GetBracket(ctx context.Context, tid id.ID) (db.Tournament, []BracketRound, error) {
	_ = s.EnforceGrandFinalDeadline(ctx)
	t, err := s.Queries.GetTournament(ctx, tid)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("get tournament: %w", err)
	}
	slots, err := s.Queries.ListTournamentSlots(ctx, tid)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("list slots: %w", err)
	}
	if len(slots) == 0 {
		return t, nil, nil
	}

	slotIDs := make([]id.ID, 0, len(slots))
	for _, sl := range slots {
		slotIDs = append(slotIDs, sl.ID)
	}
	seats, err := s.Queries.ListSeatsBySlots(ctx, slotIDs)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("list seats: %w", err)
	}
	seatsBySlot := make(map[id.ID][]db.TournamentSeat, len(slots))
	for _, se := range seats {
		seatsBySlot[se.SlotID] = append(seatsBySlot[se.SlotID], se)
	}

	byRound := make(map[[2]int][]*BracketSlot)
	roundOrder := make([][2]int, 0, len(slots))
	bracketSlots := make(map[id.ID]*BracketSlot, len(slots))
	for i := range slots {
		sl := slots[i]
		bs := &BracketSlot{
			ID:       sl.ID,
			Position: int(sl.Position),
			GameID:   sl.GameID,
			Promote:  int(sl.Promote),
			Status:   sl.Status,
		}
		if len(sl.Ruling) > 0 {
			var ruling []id.ID
			if err := json.Unmarshal(sl.Ruling, &ruling); err != nil {
				return db.Tournament{}, nil, fmt.Errorf("parse slot ruling: %w", err)
			}
			bs.Ruling = ruling
		}
		for _, se := range seatsBySlot[sl.ID] {
			seat := BracketSeat{Position: int(se.Position), PlayerID: se.PlayerID, SourceSlotID: se.SourceSlotID}
			if se.SourcePlace.Valid {
				p := int(se.SourcePlace.Int32)
				seat.SourcePlace = &p
			}
			bs.Seats = append(bs.Seats, seat)
		}
		key := [2]int{tournamentTrackRank[sl.Track], int(sl.RoundIndex)}
		if _, seen := byRound[key]; !seen {
			roundOrder = append(roundOrder, key)
		}
		byRound[key] = append(byRound[key], bs)
		bracketSlots[sl.ID] = bs
	}

	// Matches, promotions and the live standings per slot.
	for i := range slots {
		sl := slots[i]
		bs := bracketSlots[sl.ID]
		results, err := s.Queries.ListSlotMatchResults(ctx, sl.ID)
		if err != nil {
			return db.Tournament{}, nil, fmt.Errorf("list slot matches: %w", err)
		}
		var matchResults []bracket.MatchResult
		lastID := id.ID("")
		for _, r := range results {
			if r.MatchID != lastID {
				matchResults = append(matchResults, bracket.MatchResult{
					MatchID: r.MatchID,
					Scores:  make(map[id.ID]float64, 4),
				})
				bs.MatchIDs = append(bs.MatchIDs, r.MatchID)
				lastID = r.MatchID
			}
			mr := &matchResults[len(matchResults)-1]
			mr.Scores[r.PlayerID] = r.Score
		}
		if len(matchResults) > 0 && len(bs.Seats) >= 2 {
			sts := bracket.Standings(matchResults, len(bs.Seats))
			promos, err := s.Queries.ListSlotPromotions(ctx, sl.ID)
			if err != nil {
				return db.Tournament{}, nil, fmt.Errorf("list promotions: %w", err)
			}
			promoted := make(map[id.ID]bool, len(promos))
			for _, p := range promos {
				promoted[p.PlayerID] = true
			}
			for si := range sts {
				sts[si].Promoted = promoted[sts[si].PlayerID]
			}
			bs.Standings = sts
		}
	}

	rounds := make([]BracketRound, 0, len(roundOrder))
	for _, key := range roundOrder {
		br := BracketRound{Track: tournamentTrackNames[key[0]], Index: key[1]}
		for _, bs := range byRound[key] {
			br.Slots = append(br.Slots, *bs)
		}
		rounds = append(rounds, br)
	}
	return t, rounds, nil
}

// ensureTournamentArena creates the auto-managed tournament arena (ADR-24
// anchor, no filter row, no leagues — rating ≡ elo) with a name derived from
// the unique tournament name.
func (s *TournamentService) ensureTournamentArena(ctx context.Context, q *db.Queries, tid id.ID, name string) error {
	if _, err := q.GetArenaByTournament(ctx, &tid); !db.IsNoRows(err) {
		return err // exists (or real error)
	}
	settings, err := settingsDoc(startingRatingGameArenaDefault, nil)
	if err != nil {
		return err
	}
	arenaName := name
	if err := ensureArenaNameFree(ctx, q, arenaName, nil); err != nil {
		arenaName = name + " — турнир"
		if err := ensureArenaNameFree(ctx, q, arenaName, nil); err != nil {
			return err
		}
	}
	row, err := q.CreateArena(ctx, db.CreateArenaParams{
		ID:                    id.NewMonotonic(),
		Name:                  arenaName,
		MatchFilterID:         nil, // tournament arenas are link-only (ADR-26)
		Settings:              settings,
		SettingsSchemaVersion: arenasettings.CurrentVersion,
		TournamentID:          &tid,
	})
	if err != nil {
		return fmt.Errorf("create arena: %w", err)
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{row.ID})
}

// ---------------------------------------------------------------------------
// small helpers for the bracket lifecycle
// ---------------------------------------------------------------------------

// randomSeed mints the stored PRNG seed.
func randomSeed() int64 {
	var b [8]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		// Cannot start the tournament without a seed; crypto/rand failing
		// means the system is broken anyway.
		panic(fmt.Sprintf("bracket: seed: %v", err))
	}
	return int64(binary.BigEndian.Uint64(b[:]) & 0x7fffffffffffffff)
}

// fittingGames indexes the pool's games by the seat counts they can host.
func fittingGames(pool []db.TournamentGame) map[int][]id.ID {
	out := make(map[int][]id.ID, len(pool))
	for _, g := range pool {
		for k := int(g.MinPlayers); k <= int(g.MaxPlayers); k++ {
			out[k] = append(out[k], g.GameID)
		}
	}
	return out
}

// pickGame assigns one of the fitting games to a slot, seeded (a rebuild
// from the same plan + seed reproduces the same assignment).
func pickGame(rng *rand.Rand, games []id.ID) id.ID {
	if len(games) == 0 {
		return id.ID("")
	}
	return games[rng.Intn(len(games))]
}
