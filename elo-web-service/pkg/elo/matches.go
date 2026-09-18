package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type MatchService struct {
	Queries        *db.Queries
	Pool           *pgxpool.Pool
	MarketService  IMarketService
	Arenas         *ArenaService
	Tournaments    ITournamentPlay
	EventProcessor *EventProcessor
}

func NewMatchService(pool *pgxpool.Pool, marketService IMarketService, arenas *ArenaService, tournaments ITournamentPlay) IMatchService {
	return &MatchService{
		Queries:        db.New(pool),
		Pool:           pool,
		MarketService:  marketService,
		Arenas:         arenas,
		Tournaments:    tournaments,
		EventProcessor: &EventProcessor{MarketService: marketService},
	}
}

// AddMatchOpts carries optional behaviour for AddMatch, used by offline sync.
type AddMatchOpts struct {
	// ID is the client-generated ULID used as the primary key and idempotency key.
	ID id.ID
	// ClientDate marks the date as client-supplied: it is validated (no future,
	// max 30 days back) and Elo is recalculated from that date so later matches
	// are settled correctly.
	ClientDate bool
	// CampArenaIDs are the camp arenas (ADR-27) this match belongs to. Each
	// must exist, be a camp, and its window must contain the match date; the
	// links are written once and never altered afterwards.
	CampArenaIDs []id.ID
	// SkipTournamentLink is the explicit opt-out from bracket acceptance
	// (ADR-26): the unchecked tournament checkbox. By default the server
	// links the match to its unique fitting playing slot (same game, exactly
	// the seated players); fitting is always verified server-side.
	SkipTournamentLink bool
	// Calculator optionally attaches the intermediate state of the calculator
	// that produced this match. Already validated by the caller (handler);
	// stored verbatim alongside the match.
	Calculator *CalculatorInput
	// ActorUserID is the author recorded in the audit log. Zero skips the
	// audit row (see pkg/elo/audit.go).
	ActorUserID id.ID
}

// CalculatorInput is the validated calculator state attached to a new match.
type CalculatorInput struct {
	Kind string
	// Version is the schema_version recorded for this document. The handler
	// looks it up from pkg/calculator's registry; the service does not interpret it.
	Version int
	Data    json.RawMessage
}

// UpdateMatchOpts carries optional behaviour for UpdateMatch.
type UpdateMatchOpts struct {
	// CampArenaIDs is the desired camp set (ADR-27, revised): when present,
	// the server diffs it against the stored links — attaching and detaching
	// as needed, each change audited and both camps recalculated. Every
	// requested arena must exist, be a camp, and its window must contain the
	// new date. nil keeps the links untouched — then a date moved outside a
	// linked camp without detaching it is a conflict.
	CampArenaIDs *[]id.ID
	// Calculator controls how the match's calculator columns are rewritten:
	//   - nil            → leave existing calculator columns untouched
	//   - &CalculatorUpdate{Kind: nil} → clear calculator columns (set to NULL)
	//   - &CalculatorUpdate{Kind: &k, Data: d} → replace with validated document
	Calculator *CalculatorUpdate
	// SkipTournamentLink, when non-nil, is the desired tournament-link state
	// (ADR-26): true — the match must be out of the bracket (a stored slot
	// link is detached, guarded so no played downstream result is voided);
	// false — the match must be counted (attached to the unique fitting
	// playing slot); nil — leave the association untouched.
	SkipTournamentLink *bool
	// ActorUserID is the editor recorded in the audit log. Zero skips the
	// audit row (see pkg/elo/audit.go).
	ActorUserID id.ID
}

// CalculatorUpdate describes a change to a match's calculator columns.
type CalculatorUpdate struct {
	// Kind is nil to clear the columns; non-nil with Data to replace.
	Kind    *string
	Version int
	Data    json.RawMessage
}

type IMatchService interface {
	AddMatch(ctx context.Context, gameID id.ID, playerScores map[id.ID]float64, date time.Time, opts AddMatchOpts) (db.Match, error)
	UpdateMatch(ctx context.Context, matchID id.ID, gameID id.ID, playerScores map[id.ID]float64, date time.Time, opts UpdateMatchOpts) (db.Match, error)

	// RecalculateAllGlobalElo replays the whole settlement history from the
	// beginning (the computation an edit+save of the first match triggers) and
	// reports every player whose global arena state changed. Debug/monitoring
	// tool: a stable recalculation must report no changed players.
	RecalculateAllGlobalElo(ctx context.Context) (GlobalReplayReport, error)

	// DeleteMarketAndRecalculate hard-deletes an open market and recalculates
	// Elo from the market's created_at date. Returns ErrMarketNotOpen if the
	// market is already resolved or cancelled.
	DeleteMarketAndRecalculate(ctx context.Context, marketID id.ID) error

	// Read-side queries used by the match list/detail handlers.
	ListMatchesWithPlayersPaginated(ctx context.Context, arg db.ListMatchesWithPlayersPaginatedParams) ([]db.ListMatchesWithPlayersPaginatedRow, error)
	GetMatchWithPlayers(ctx context.Context, matchID id.ID) ([]db.GetMatchWithPlayersRow, error)
	ListCampArenasByMatchIDs(ctx context.Context, matchIDs []id.ID) ([]db.ListCampArenasByMatchIDsRow, error)
}

// calculatorColumns builds the three sqlc params fields for calculator columns
// from a CalculatorInput (or returns the all-NULL form when input is nil).
func calculatorColumns(c *CalculatorInput) (pgtype.Text, pgtype.Int4, json.RawMessage) {
	if c == nil {
		return pgtype.Text{}, pgtype.Int4{}, nil
	}
	return pgtype.Text{String: c.Kind, Valid: true},
		pgtype.Int4{Int32: int32(c.Version), Valid: true},
		c.Data
}

// calculatorColumnsFromUpdate resolves the new column values from an update
// instruction. Returns the all-NULL form when the update clears the columns.
func calculatorColumnsFromUpdate(u *CalculatorUpdate) (pgtype.Text, pgtype.Int4, json.RawMessage) {
	if u == nil || u.Kind == nil {
		return pgtype.Text{}, pgtype.Int4{}, nil
	}
	return pgtype.Text{String: *u.Kind, Valid: true},
		pgtype.Int4{Int32: int32(u.Version), Valid: true},
		u.Data
}

// AddMatch adds a single match with Elo calculations
// Validates that game_id and all player_ids exist via foreign key constraints
func (s *MatchService) AddMatch(ctx context.Context, gameID id.ID, playerScores map[id.ID]float64, date time.Time, opts AddMatchOpts) (db.Match, error) {
	if len(playerScores) < 2 {
		return db.Match{}, ErrTooFewPlayers
	}

	if opts.ClientDate {
		if err := validateNewMatchDate(time.Now(), date); err != nil {
			return db.Match{}, err
		}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	dt := pgtype.Timestamptz{Time: date, Valid: true}

	calcKind, calcVer, calcData := calculatorColumns(opts.Calculator)

	// Audit "created" only for genuinely new rows: CreateMatch upserts on id,
	// and an offline-sync replay must not emit a second created event. A zero
	// id cannot exist yet — skip the probe and let CreateMatch surface the
	// missing-id error on its original code path.
	isNew := true
	if !opts.ID.IsZero() {
		_, err = q.GetMatch(ctx, opts.ID)
		isNew = db.IsNoRows(err)
		if err != nil && !isNew {
			return db.Match{}, fmt.Errorf("unable to check match existence: %w", err)
		}
	}

	// create match (foreign key will validate game_id exists)
	// ON CONFLICT (id) DO UPDATE returns the existing row on retry (idempotency).
	createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
		ID:                      opts.ID,
		Date:                    dt,
		GameID:                  gameID,
		CalculatorKind:          calcKind,
		CalculatorSchemaVersion: calcVer,
		CalculatorData:          calcData,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to create match: %w", err)
	}

	if isNew {
		if err := recordAuditEvent(ctx, q, opts.ActorUserID, audit.EntityMatch, audit.ActionCreated, createdMatch.ID, "", nil); err != nil {
			return db.Match{}, err
		}
	}

	if opts.ClientDate {
		// Client-supplied (possibly backdated) date: write scores, then replay all
		// events from that date so this match and every later one settle in order.
		for playerID, score := range playerScores {
			if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
				MatchID:  createdMatch.ID,
				PlayerID: playerID,
				Score:    score,
			}); err != nil {
				return db.Match{}, fmt.Errorf("unable to insert match score for player %s: %w", playerID, err)
			}
		}

		if err := s.recalculateEloFromDate(ctx, q, date); err != nil {
			return db.Match{}, fmt.Errorf("unable to recalculate Elo: %w", err)
		}
	} else {
		// Lock players and collect all prior state needed for dual-track settlement
		state, err := s.lockAndGetPrevElos(ctx, q, createdMatch, playerScores)
		if err != nil {
			return db.Match{}, err
		}

		playerIDs := make([]id.ID, 0, len(playerScores))
		for playerID := range playerScores {
			playerIDs = append(playerIDs, playerID)
		}

		if err := s.EventProcessor.processMatchSettlements(
			ctx, q, createdMatch.ID, playerScores,
			state, date,
			s.calculateAndStoreEloWithScores,
		); err != nil {
			return db.Match{}, err
		}

		if err := RecalculateBetLimits(ctx, q, playerIDs); err != nil {
			return db.Match{}, fmt.Errorf("recalculate bet limits: %w", err)
		}
	}

	// ADR-27: link the match to the requested camp arenas. Each id is
	// validated (exists, is a camp, window contains the date); the links are
	// written once and never altered afterwards.
	campArenas, err := resolveCampArenas(ctx, q, opts.CampArenaIDs, date)
	if err != nil {
		return db.Match{}, err
	}
	if isNew {
		for _, c := range campArenas {
			if err := q.AddCampMatch(ctx, db.AddCampMatchParams{ArenaID: c.ID, MatchID: createdMatch.ID}); err != nil {
				return db.Match{}, fmt.Errorf("link match %s to camp %s: %w", createdMatch.ID, c.ID, err)
			}
			if err := recordAuditEvent(ctx, q, opts.ActorUserID, audit.EntityArena, audit.ActionCreated, c.ID,
				audit.KindCampLink, audit.NewCampLinkDetails(audit.CampLinkAttach, string(createdMatch.ID))); err != nil {
				return db.Match{}, err
			}
		}
	}

	// ADR-26: tournament bracket acceptance. The match links to its unique
	// fitting playing slot when the checkbox is on (the default); the link,
	// the placement points, and any completion cascade happen in this
	// transaction. Must run before the arena drain below: the tournament
	// arena's membership is the tournament_matches link written here.
	if !opts.SkipTournamentLink && s.Tournaments != nil {
		if err := s.Tournaments.AcceptMatch(ctx, q, createdMatch.ID, gameID, playerIDsOf(playerScores), opts.ActorUserID); err != nil {
			return db.Match{}, err
		}
	}

	// ADR-24: the match write touches every arena containing it — the
	// membership function covers camps via their camp_matches links (written
	// above) — update them synchronously in this transaction (the global
	// arena was already replayed above; the drain skips it).
	affected, err := q.ListArenasMatchingMatch(ctx, createdMatch.ID)
	if err != nil {
		return db.Match{}, fmt.Errorf("list arenas matching match: %w", err)
	}
	if err := s.Arenas.MarkAndDrainAfterMatchWrite(ctx, q, affected, date); err != nil {
		return db.Match{}, fmt.Errorf("update arenas after match write: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %w", err)
	}

	return createdMatch, nil
}

// UpdateMatch updates an existing match and recalculates Elo ratings for all affected matches
// Date cannot be null and cannot change more than 3 days
//
// When opts.Calculator is nil the match's calculator columns are left untouched;
// when it is &CalculatorUpdate{Kind: nil} they are cleared; otherwise they are
// replaced with the validated document.
func (s *MatchService) UpdateMatch(ctx context.Context, matchID id.ID, gameID id.ID, playerScores map[id.ID]float64, date time.Time, opts UpdateMatchOpts) (db.Match, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	existingMatch, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("%w: %v", ErrMatchNotFound, err)
	}

	oldDate := existingMatch.Date.Time
	if err := validateMatchDateChange(oldDate, date); err != nil {
		return db.Match{}, err
	}

	// ADR-27 (revised): camp links are editable — editing a match exists to
	// fix mistakes, and the recalculation machinery rewrites the camps'
	// settlements and medal stats accordingly. The optional body set is the
	// desired set: every requested arena is validated (exists, is a camp,
	// window contains the date); a body without the key keeps the stored
	// links, which the new date must still stay inside.
	linkedCamps, err := campArenasOfMatch(ctx, q, matchID)
	if err != nil {
		return db.Match{}, err
	}
	desiredCamps := linkedCamps
	if opts.CampArenaIDs != nil {
		desiredCamps, err = resolveCampArenas(ctx, q, *opts.CampArenaIDs, date)
		if err != nil {
			return db.Match{}, err
		}
	} else {
		for _, c := range linkedCamps {
			if !campWindowContains(c, date) {
				return db.Match{}, ErrMatchOutsideCampWindows
			}
		}
	}

	// ADR-26: a tournament-linked match keeps its exact player set and game —
	// editing never silently changes whether the match counts for the bracket
	// (the organizer detaches first). Scores, date and calculator data stay
	// freely editable below; a non-linked match can never become linked here.
	if s.Tournaments != nil {
		if err := s.Tournaments.CheckAssociationEditable(ctx, q, matchID, gameID, playerIDsOf(playerScores)); err != nil {
			return db.Match{}, err
		}
	}

	// Capture the arenas containing the match BEFORE the row changes — after a
	// date/game change they need a recalculation even when the new state no
	// longer contains them.
	affectedBefore, err := q.ListArenasMatchingMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("list arenas matching match: %w", err)
	}

	recalcStartDate := date
	if existingMatch.Date.Valid && existingMatch.Date.Time.Before(date) {
		recalcStartDate = existingMatch.Date.Time
	}

	updateParams := db.UpdateMatchParams{
		ID:                      matchID,
		Date:                    pgtype.Timestamptz{Time: date, Valid: true},
		GameID:                  gameID,
		CalculatorKind:          existingMatch.CalculatorKind,
		CalculatorSchemaVersion: existingMatch.CalculatorSchemaVersion,
		CalculatorData:          existingMatch.CalculatorData,
	}
	if opts.Calculator != nil {
		k, v, d := calculatorColumnsFromUpdate(opts.Calculator)
		updateParams.CalculatorKind = k
		updateParams.CalculatorSchemaVersion = v
		updateParams.CalculatorData = d
	}
	if err = q.UpdateMatch(ctx, updateParams); err != nil {
		return db.Match{}, fmt.Errorf("unable to update match: %w", err)
	}

	// Audit diff inputs. Old scores must be read before the rewrite deletes
	// them; the calculator columns are compared as resolved above (tri-state)
	// against the row as stored.
	oldScores, err := q.GetMatchScores(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to read old match scores: %w", err)
	}
	calcVerChanged := updateParams.CalculatorSchemaVersion.Valid != existingMatch.CalculatorSchemaVersion.Valid ||
		(updateParams.CalculatorSchemaVersion.Valid && updateParams.CalculatorSchemaVersion.Int32 != existingMatch.CalculatorSchemaVersion.Int32)
	calculatorChanged := !textEqual(updateParams.CalculatorKind, existingMatch.CalculatorKind) ||
		calcVerChanged || !jsonEqual(updateParams.CalculatorData, existingMatch.CalculatorData)

	// Delete old scores to handle player list changes. The arena settlement
	// rows are removed by the replays below: the global replay deletes from
	// the recalc start date, the arena drain deletes from its replay date —
	// both windows cover the match's old date.
	err = q.DeleteMatchScores(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to delete old match scores: %w", err)
	}

	for playerID, score := range playerScores {
		err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
		})
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to insert match score for player %s: %w", playerID, err)
		}
	}

	if err := s.recalculateEloFromDate(ctx, q, recalcStartDate); err != nil {
		return db.Match{}, fmt.Errorf("unable to recalculate Elo: %w", err)
	}

	// Apply the desired camp-link diff (attach/detach, each audited). Must
	// run before the drain below: the camp replay reads camp_matches.
	if err := applyCampLinkDiff(ctx, q, opts.ActorUserID, matchID, linkedCamps, desiredCamps); err != nil {
		return db.Match{}, err
	}

	// ADR-26: the edit form's desired tournament-link state, applied before
	// OnMatchChanged below (a just-unlinked match then has no slot to
	// re-evaluate; a just-linked one is re-evaluated by the attach itself).
	// A change is refused while it would void already-played downstream
	// matches — that stays the organizer's explicit tool.
	if s.Tournaments != nil && opts.SkipTournamentLink != nil {
		if err := s.Tournaments.SetMatchLinkState(ctx, q, matchID, *opts.SkipTournamentLink, opts.ActorUserID); err != nil {
			return db.Match{}, err
		}
	}

	// ADR-26: scores changed → points recompute → completion re-evaluates →
	// possibly a different promotion set (with the cascade invalidation) —
	// still inside the match-write transaction, before the arena drain.
	if s.Tournaments != nil {
		if err := s.Tournaments.OnMatchChanged(ctx, q, matchID, opts.ActorUserID); err != nil {
			return db.Match{}, err
		}
	}

	// ADR-24: update every arena whose membership the edit affects — the
	// union of the arenas containing the old and the new match state —
	// synchronously. The membership function includes camps: affectedBefore
	// runs before the link diff (old links), affectedAfter after it (new
	// links), so a detach replays the old camp to remove its settlements and
	// stats.
	affectedAfter, err := q.ListArenasMatchingMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("list arenas matching match: %w", err)
	}
	union := make([]id.ID, 0, len(affectedBefore)+len(affectedAfter))
	seen := make(map[id.ID]bool, len(affectedBefore)+len(affectedAfter))
	for _, aid := range append(affectedBefore, affectedAfter...) {
		if !seen[aid] {
			seen[aid] = true
			union = append(union, aid)
		}
	}
	if err := s.Arenas.MarkAndDrainAfterMatchWrite(ctx, q, union, recalcStartDate); err != nil {
		return db.Match{}, fmt.Errorf("update arenas after match write: %w", err)
	}

	// Record the edit in the audit log. An edit that changed nothing produces
	// no audit row.
	details := buildMatchUpdateDetails(existingMatch, oldScores, date, gameID, playerScores, calculatorChanged)
	if !details.IsEmpty() {
		if err := recordAuditEvent(ctx, q, opts.ActorUserID, audit.EntityMatch, audit.ActionUpdated, matchID, audit.KindMatchUpdate, details); err != nil {
			return db.Match{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %w", err)
	}

	updatedMatch, err := s.Queries.GetMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to fetch updated match: %v", matchID)
	}
	return updatedMatch, nil
}

// DeleteMarketAndRecalculate hard-deletes an open market and recalculates Elo
// from the market's created_at date. Everything runs in a single transaction.
func (s *MatchService) DeleteMarketAndRecalculate(ctx context.Context, marketID id.ID) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" && market.Status != "betting_closed" {
		return ErrMarketNotOpen
	}

	createdAt := market.CreatedAt.Time

	if err := q.DeleteArenaSettlementByMarket(ctx, db.DeleteArenaSettlementByMarketParams{
		ArenaID:  GlobalArenaID,
		MarketID: &marketID,
	}); err != nil {
		return fmt.Errorf("delete global arena settlement for market %s: %w", marketID, err)
	}

	if err := q.DeleteMarket(ctx, marketID); err != nil {
		return fmt.Errorf("delete market %s: %w", marketID, err)
	}

	if err := s.recalculateEloFromDate(ctx, q, createdAt); err != nil {
		return fmt.Errorf("recalculate elo from %v: %w", createdAt, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	s.MarketService.ScheduleNextExpiry(context.Background())
	return nil
}

// recalculateEloFromDate delegates to EventProcessor.RecalculateFrom.
// Must be called within a transaction.
func (s *MatchService) recalculateEloFromDate(ctx context.Context, q *db.Queries, startDate time.Time) error {
	return s.EventProcessor.RecalculateFrom(ctx, q, startDate, s.calculateAndUpdateElo, s.lockAndGetPrevElos)
}

// lockAndGetPrevElos locks the match's players in sorted order and returns
// their prior state in the global arena — the only arena the transactional
// settlement path (matches, markets, corrections) maintains (ADR-24).
func (s *MatchService) lockAndGetPrevElos(ctx context.Context, q *db.Queries, match db.Match, playerScores map[id.ID]float64) (MatchPrevState, error) {
	globalArena, err := s.Arenas.GetArena(ctx, GlobalArenaID)
	if err != nil {
		return MatchPrevState{}, fmt.Errorf("get global arena: %w", err)
	}
	prev, err := lockAndGetPrevArenaState(ctx, q, globalArena, match, playerScores)
	if err != nil {
		return MatchPrevState{}, err
	}
	return MatchPrevState{
		Arena:    globalArena,
		Elo:      prev.Elo,
		Rating:   prev.Rating,
		League:   prev.League,
		Count6M:  prev.Count6M,
		Count2M:  prev.Count2M,
		Settings: prev.Settings,
	}, nil
}

// eloCalcResult and buildEloResults moved to arena_calc.go: since ADR-24 the
// per-match settlement calculation is arena-generic (buildArenaResults) and
// every arena — the global one included — goes through the same code.

// calculateAndStoreEloWithScores inserts match_scores then upserts the global
// arena settlement. Used by AddMatch to write scores and Elo for a new match.
func (s *MatchService) calculateAndStoreEloWithScores(ctx context.Context, q *db.Queries, matchID id.ID, playerScores map[id.ID]float64, state MatchPrevState) error {
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %s: %w", matchID, err)
	}
	for playerID, score := range playerScores {
		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
		}); err != nil {
			return fmt.Errorf("unable to upsert match score for player %s: %w", playerID, err)
		}
	}
	return storeArenaMatchSettlements(ctx, q, state.Arena, match, playerScores, ArenaPrevState{
		Elo:      state.Elo,
		Rating:   state.Rating,
		League:   state.League,
		Count6M:  state.Count6M,
		Count2M:  state.Count2M,
		Settings: state.Settings,
	})
}

// calculateAndUpdateElo upserts the global arena settlement records without
// touching match_scores. Used by recalculation paths where scores already exist.
func (s *MatchService) calculateAndUpdateElo(ctx context.Context, q *db.Queries, matchID id.ID, playerScores map[id.ID]float64, state MatchPrevState) error {
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %s: %w", matchID, err)
	}
	return storeArenaMatchSettlements(ctx, q, state.Arena, match, playerScores, ArenaPrevState{
		Elo:      state.Elo,
		Rating:   state.Rating,
		League:   state.League,
		Count6M:  state.Count6M,
		Count2M:  state.Count2M,
		Settings: state.Settings,
	})
}

// sortPlayerIDs sorts player IDs numerically (for consistent locking order)
func sortPlayerIDs(ids []id.ID) { slices.Sort(ids) }

// playerIDsOf returns the keys of a player→score map as a slice.
func playerIDsOf(playerScores map[id.ID]float64) []id.ID {
	ids := make([]id.ID, 0, len(playerScores))
	for pid := range playerScores {
		ids = append(ids, pid)
	}
	return ids
}

// ListMatchesWithPlayersPaginated is the paginated match-list read for the
// ListMatches handler.
func (s *MatchService) ListMatchesWithPlayersPaginated(ctx context.Context, arg db.ListMatchesWithPlayersPaginatedParams) ([]db.ListMatchesWithPlayersPaginatedRow, error) {
	return s.Queries.ListMatchesWithPlayersPaginated(ctx, arg)
}

// GetMatchWithPlayers is the single-match read for the GetMatchById handler.
func (s *MatchService) GetMatchWithPlayers(ctx context.Context, matchID id.ID) ([]db.GetMatchWithPlayersRow, error) {
	return s.Queries.GetMatchWithPlayers(ctx, matchID)
}

// ListCampArenasByMatchIDs returns the camp arenas (ADR-27) linked to a set
// of matches; used by both the list and detail handlers.
func (s *MatchService) ListCampArenasByMatchIDs(ctx context.Context, matchIDs []id.ID) ([]db.ListCampArenasByMatchIDsRow, error) {
	return s.Queries.ListCampArenasByMatchIDs(ctx, matchIDs)
}
