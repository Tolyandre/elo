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
	// stored verbatim alongside the match. A calculator match is always
	// competitive (ADR-33).
	Calculator *CalculatorInput
	// Mode is the per-match mode request (ADR-33) for mixed games; "" means
	// competitive. Coop-only and competitive-only games decide the mode
	// themselves and reject a contradicting request.
	Mode string
	// PlayerIDs is the participant list of a coop match (no per-player
	// scores); required when the resolved mode is coop, rejected otherwise.
	PlayerIDs []id.ID
	// GameScore/GameWon are the shared coop result (ADR-33): required when the
	// resolved mode is coop, rejected otherwise.
	GameScore *float64
	GameWon   *bool
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
	// Mode is the desired mode (ADR-33): meaningful only for mixed games; a
	// value contradicting the game's own mode is rejected.
	Mode string
	// PlayerIDs is the desired participant list of a coop match (no
	// per-player scores); required when the resulting mode is coop, rejected
	// otherwise.
	PlayerIDs []id.ID
	// GameScore/GameWon are the shared coop result (ADR-33): required when the
	// resulting mode is coop, rejected otherwise.
	GameScore *float64
	GameWon   *bool
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

	// RecalculateGlobalWithinTx is the TenantService's replay handle (ADR-36):
	// re-settles the global arena from startDate inside the caller's open
	// transaction, honoring the main-arena openness at every match date.
	RecalculateGlobalWithinTx(ctx context.Context, q *db.Queries, startDate time.Time) error

	// ReplayStaleGlobal drains the global arena at boot when a migration
	// marked it stale (ADR-36 phase 5); a no-op otherwise.
	ReplayStaleGlobal(ctx context.Context) error

	// DeleteMarketAndRecalculate hard-deletes an open market and recalculates
	// Elo from the market's created_at date. Returns ErrMarketNotOpen if the
	// market is already resolved or cancelled.
	DeleteMarketAndRecalculate(ctx context.Context, marketID id.ID) error

	// Read-side queries used by the match list/detail handlers. The rating
	// columns are scoped to the given display arena (ADR-36: the caller's
	// current tenant main arena; the global arena until ?tenant= lands).
	ListMatchesWithPlayersPaginated(ctx context.Context, arg db.ListMatchesWithPlayersPaginatedParams) ([]db.ListMatchesWithPlayersPaginatedRow, error)
	GetMatchWithPlayers(ctx context.Context, matchID, arenaID id.ID) ([]db.GetMatchWithPlayersRow, error)
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

// resolveMatchMode derives the stored match mode (ADR-33) from the game's
// mode and the request value; a match with calculator columns is always
// competitive, and asking for a calculator coop match is a client bug.
func resolveMatchMode(gameMode, requestMode string, hasCalculator bool) (string, error) {
	mode, err := MatchModeForGame(gameMode, requestMode)
	if err != nil {
		return "", err
	}
	if !hasCalculator {
		return mode, nil
	}
	if requestMode == MatchModeCoop {
		return "", ErrModeContradictsGame
	}
	return MatchModeCompetitive, nil
}

// normalizeMatchParticipants builds the participant→score map: competitive
// matches take it from the per-player scores, coop matches from the plain id
// list (zero scores — the shared result lives on the match row, ADR-33).
func normalizeMatchParticipants(mode string, playerScores map[id.ID]float64, playerIDs []id.ID) (map[id.ID]float64, error) {
	if mode == MatchModeCoop {
		if len(playerScores) > 0 {
			return nil, ErrCoopScoresRejected
		}
		if len(playerIDs) == 0 {
			return nil, ErrCoopNoParticipants
		}
		out := make(map[id.ID]float64, len(playerIDs))
		for _, pid := range playerIDs {
			out[pid] = 0
		}
		return out, nil
	}
	if len(playerIDs) > 0 {
		return nil, ErrCompetitiveMismatch
	}
	if len(playerScores) < 2 {
		return nil, ErrTooFewPlayers
	}
	return playerScores, nil
}

// validateMatchResult checks the shared game result against the resolved
// mode: required for coop, rejected for competitive.
func validateMatchResult(mode string, gameScore *float64, gameWon *bool) error {
	if mode == MatchModeCoop {
		if gameScore == nil || gameWon == nil {
			return ErrCoopResultRequired
		}
		return nil
	}
	if gameScore != nil || gameWon != nil {
		return ErrCompetitiveMismatch
	}
	return nil
}

func pgFloat8(f *float64) pgtype.Float8 {
	if f == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *f, Valid: true}
}

func pgBool(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

// AddMatch adds a single match with Elo calculations
// Validates that game_id and all player_ids exist via foreign key constraints
func (s *MatchService) AddMatch(ctx context.Context, gameID id.ID, playerScores map[id.ID]float64, date time.Time, opts AddMatchOpts) (db.Match, error) {
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

	// The game's mode decides (with the request, for mixed games) whether this
	// is a rating match or a coop one (ADR-33).
	game, err := q.GetGameByID(ctx, gameID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to get game: %w", err)
	}
	mode, err := resolveMatchMode(game.GameMode, opts.Mode, opts.Calculator != nil)
	if err != nil {
		return db.Match{}, err
	}
	playerScores, err = normalizeMatchParticipants(mode, playerScores, opts.PlayerIDs)
	if err != nil {
		return db.Match{}, err
	}
	if err := validateMatchResult(mode, opts.GameScore, opts.GameWon); err != nil {
		return db.Match{}, err
	}
	if mode == MatchModeCoop && len(opts.CampArenaIDs) > 0 {
		return db.Match{}, ErrCoopLinksRejected
	}

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
		Mode:                    mode,
		GameScore:               pgFloat8(opts.GameScore),
		GameWon:                 pgBool(opts.GameWon),
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
		if mode == MatchModeCompetitive {
			// Lock players and collect all prior state needed for dual-track
			// settlement. settles=false when the tenant predicate (ADR-36) keeps
			// the match out of the global arena's rating.
			state, settles, err := s.lockAndGetPrevElos(ctx, q, createdMatch, playerScores)
			if err != nil {
				return db.Match{}, err
			}

			if !settles {
				// No Elo settlement — the participant rows still record the
				// match's players (they are what the tenant predicate of a
				// later mode change / recalculation reads).
				for playerID, score := range playerScores {
					if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
						MatchID:  createdMatch.ID,
						PlayerID: playerID,
						Score:    score,
					}); err != nil {
						return db.Match{}, fmt.Errorf("unable to insert match score for player %s: %w", playerID, err)
					}
				}
			}

			if err := s.EventProcessor.processMatchSettlements(
				ctx, q, createdMatch.ID, playerScores,
				state, date,
				mode,
				settles,
				s.calculateAndStoreEloWithScores,
			); err != nil {
				return db.Match{}, err
			}
		} else {
			// A coop match settles nothing (ADR-33): no Elo, no market
			// resolution. Its zero-score participant rows are still written —
			// they are the participant list — and time-based market expiry
			// still advances: the match is a point on the replay timeline
			// regardless of its mode.
			for playerID := range playerScores {
				if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
					MatchID:  createdMatch.ID,
					PlayerID: playerID,
					Score:    0,
				}); err != nil {
					return db.Match{}, fmt.Errorf("unable to insert match score for player %s: %w", playerID, err)
				}
			}
			if err := s.MarketService.ExpireMarketsAtDate(ctx, q, date); err != nil {
				return db.Match{}, fmt.Errorf("expire markets at date %v: %w", date, err)
			}
		}
	}

	// ADR-27: link the match to the requested camp arenas. Each id is
	// validated (exists, is a camp, window contains the date); the links are
	// written once and never altered afterwards. Coop matches join no camps
	// (ADR-33) — rejected above with the rest of the link requests.
	campArenas, err := resolveCampArenas(ctx, q, opts.CampArenaIDs, date)
	if err != nil {
		return db.Match{}, err
	}
	if isNew {
		for _, c := range campArenas {
			if err := q.AddArenaMatch(ctx, db.AddArenaMatchParams{ArenaID: c.ID, MatchID: createdMatch.ID}); err != nil {
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
	// arena's membership is the arena_matches link written here. Coop matches
	// never enter a bracket (ADR-33).
	if mode == MatchModeCompetitive && !opts.SkipTournamentLink && s.Tournaments != nil {
		if err := s.Tournaments.AcceptMatch(ctx, q, createdMatch.ID, gameID, playerIDsOf(playerScores), opts.ActorUserID); err != nil {
			return db.Match{}, err
		}
	}

	// ADR-24: the match write touches every arena containing it — the
	// membership function covers camps via their arena_matches links (written
	// above) — update them synchronously in this transaction (the global
	// arena was already replayed above; the drain skips it). A coop match
	// belongs to no arena (the membership function rejects its mode), so the
	// drain is skipped for it.
	if mode == MatchModeCompetitive {
		affected, err := q.ListArenasMatchingMatch(ctx, createdMatch.ID)
		if err != nil {
			return db.Match{}, fmt.Errorf("list arenas matching match: %w", err)
		}
		if err := s.Arenas.MarkAndDrainAfterMatchWrite(ctx, q, affected, date); err != nil {
			return db.Match{}, fmt.Errorf("update arenas after match write: %w", err)
		}
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

	// The game's mode decides (with the request, for mixed games) whether
	// this stays a rating match or becomes a coop one (ADR-33); calculator
	// columns keep the match competitive.
	game, err := q.GetGameByID(ctx, gameID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to get game: %w", err)
	}
	hasCalculator := existingMatch.CalculatorKind.Valid ||
		(opts.Calculator != nil && opts.Calculator.Kind != nil)
	mode, err := resolveMatchMode(game.GameMode, opts.Mode, hasCalculator)
	if err != nil {
		return db.Match{}, err
	}
	playerScores, err = normalizeMatchParticipants(mode, playerScores, opts.PlayerIDs)
	if err != nil {
		return db.Match{}, err
	}
	if err := validateMatchResult(mode, opts.GameScore, opts.GameWon); err != nil {
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
	// A coop match belongs to no camp (ADR-33): converting one requires
	// detaching it from every camp in the same edit.
	if mode == MatchModeCoop && len(desiredCamps) > 0 {
		return db.Match{}, ErrCoopLinksRejected
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
		Mode:                    mode,
		GameScore:               pgFloat8(opts.GameScore),
		GameWon:                 pgBool(opts.GameWon),
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
	// run before the drain below: the camp replay reads arena_matches.
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
	// A coop match must be out of the bracket (ADR-33): converting one
	// detaches it (the same guarded detach; an unsafe detach refuses the
	// whole edit). A no-op when already unlinked.
	if mode == MatchModeCoop && s.Tournaments != nil {
		if err := s.Tournaments.SetMatchLinkState(ctx, q, matchID, true, opts.ActorUserID); err != nil {
			return db.Match{}, err
		}
	}

	// ADR-26: scores changed → points recompute → completion re-evaluates →
	// possibly a different advancement set (with the cascade invalidation) —
	// still inside the match-write transaction, before the arena drain. A
	// coop match has no slot to re-evaluate (ADR-33).
	if s.Tournaments != nil && mode == MatchModeCompetitive {
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
	if err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		market, err := q.GetMarket(ctx, marketID)
		if err != nil {
			return fmt.Errorf("get market: %w", err)
		}
		if market.Status != "open" && market.Status != "betting_closed" {
			return ErrMarketNotOpen
		}

		createdAt := market.CreatedAt.Time

		// The market's settlements live in its tenant's main arena (ADR-36);
		// delete them there before the market row itself is hard-deleted.
		arena, err := marketArena(ctx, q, market.TenantID)
		if err != nil {
			return err
		}
		if err := q.DeleteArenaSettlementByMarket(ctx, db.DeleteArenaSettlementByMarketParams{
			ArenaID:  arena.ID,
			MarketID: &marketID,
		}); err != nil {
			return fmt.Errorf("delete settlements of market %s: %w", marketID, err)
		}

		if err := q.DeleteMarket(ctx, marketID); err != nil {
			return fmt.Errorf("delete market %s: %w", marketID, err)
		}

		if err := s.recalculateEloFromDate(ctx, q, createdAt); err != nil {
			return fmt.Errorf("recalculate elo from %v: %w", createdAt, err)
		}
		return nil
	}); err != nil {
		return err
	}

	s.MarketService.ScheduleNextExpiry(context.Background())
	return nil
}

// recalculateEloFromDate delegates to EventProcessor.RecalculateFrom.
// Must be called within a transaction.
func (s *MatchService) recalculateEloFromDate(ctx context.Context, q *db.Queries, startDate time.Time) error {
	return s.EventProcessor.RecalculateFrom(ctx, q, startDate, s.calculateAndUpdateElo, s.lockAndGetPrevElos)
}

// IGlobalReplay is the TenantService's handle for the full global-arena replay
// (ADR-36): a main-arena openness, composition or settings change on the
// converted global arena must re-settle the whole history in the caller's
// transaction — the global arena is never drained by the background worker
// (that would lose its market settlements).
type IGlobalReplay interface {
	RecalculateGlobalWithinTx(ctx context.Context, q *db.Queries, startDate time.Time) error
}

// RecalculateGlobalWithinTx replays the global arena's settlements (matches,
// markets) from startDate — the settlement gate inside respects
// the tenant's openness mode at every match date.
func (s *MatchService) RecalculateGlobalWithinTx(ctx context.Context, q *db.Queries, startDate time.Time) error {
	return s.recalculateEloFromDate(ctx, q, startDate)
}

// ReplayStaleGlobal drains the global arena when a migration marked it stale
// (ADR-36 phase 5: migration 071 deleted the correction settlements, so the
// arena's chains had to be rebuilt by history replay). The background worker
// never drains the global arena — it is maintained transactionally by the
// settlement path — so boot does it here: a full in-transaction replay, then
// the stale mark clears. A no-op when the arena is not stale.
func (s *MatchService) ReplayStaleGlobal(ctx context.Context) error {
	row, err := s.Queries.GetArena(ctx, GlobalArenaID)
	if err != nil {
		return fmt.Errorf("get global arena: %w", err)
	}
	if !row.StaleAt.Valid {
		return nil
	}
	mark := row.StaleAt
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.RecalculateGlobalWithinTx(ctx, q, time.Time{}); err != nil {
			return err
		}
		// Conditional clear: a re-mark during the run leaves the arena stale
		// (staleness cancellation, ADR-24).
		return q.ClearArenaStale(ctx, db.ClearArenaStaleParams{ID: GlobalArenaID, StaleAt: mark})
	})
}

// lockAndGetPrevElos locks the match's players in sorted order and returns
// their prior state in the global arena — the arena the transactional
// settlement path (matches, markets) maintains (ADR-24).
//
// Since the attribution phase (ADR-36) the global arena is «Синие люди»'s
// main arena: the tenant's openness mode, evaluated at the match date against
// the membership stints of its clubs, decides whether the match settles into
// it at all. When the tenant predicate does not hold, settles=false and
// nothing is locked —
// the caller must still advance everything that is not Elo settlement
// (market resolution, expiry) and must write the match's score rows itself.
func (s *MatchService) lockAndGetPrevElos(ctx context.Context, q *db.Queries, match db.Match, playerScores map[id.ID]float64) (MatchPrevState, bool, error) {
	globalArena, err := s.Arenas.GetArena(ctx, GlobalArenaID)
	if err != nil {
		return MatchPrevState{}, false, fmt.Errorf("get global arena: %w", err)
	}
	if globalArena.TenantID != nil {
		contains, err := q.TenantContainsPlayers(ctx, db.TenantContainsPlayersParams{
			TenantID:  *globalArena.TenantID,
			PlayerIds: playerIDsOf(playerScores),
			Date:      match.Date.Time,
		})
		if err != nil {
			return MatchPrevState{}, false, fmt.Errorf("check tenant membership: %w", err)
		}
		if !contains {
			return MatchPrevState{}, false, nil
		}
	}
	prev, err := lockAndGetPrevArenaState(ctx, q, globalArena, match, playerScores)
	if err != nil {
		return MatchPrevState{}, false, err
	}
	return MatchPrevState{
		Arena:    globalArena,
		Elo:      prev.Elo,
		Rating:   prev.Rating,
		League:   prev.League,
		Count6M:  prev.Count6M,
		Count2M:  prev.Count2M,
		Settings: prev.Settings,
	}, true, nil
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

// GetMatchWithPlayers is the single-match read for the GetMatchById handler;
// rating columns are scoped to arenaID.
func (s *MatchService) GetMatchWithPlayers(ctx context.Context, matchID, arenaID id.ID) ([]db.GetMatchWithPlayersRow, error) {
	return s.Queries.GetMatchWithPlayers(ctx, db.GetMatchWithPlayersParams{ID: matchID, ArenaID: arenaID})
}

// ListCampArenasByMatchIDs returns the camp arenas (ADR-27) linked to a set
// of matches; used by both the list and detail handlers.
func (s *MatchService) ListCampArenasByMatchIDs(ctx context.Context, matchIDs []id.ID) ([]db.ListCampArenasByMatchIDsRow, error) {
	return s.Queries.ListCampArenasByMatchIDs(ctx, matchIDs)
}
