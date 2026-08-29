package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
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
	EventProcessor *EventProcessor
}

func NewMatchService(pool *pgxpool.Pool, marketService IMarketService) IMatchService {
	return &MatchService{
		Queries:        db.New(pool),
		Pool:           pool,
		MarketService:  marketService,
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
	// TournamentIDs are the tournaments this match belongs to. The match is
	// associated with each, and every match player is auto-enrolled into them.
	TournamentIDs []id.ID
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
	TournamentIDs []id.ID
	// Calculator controls how the match's calculator columns are rewritten:
	//   - nil            → leave existing calculator columns untouched
	//   - &CalculatorUpdate{Kind: nil} → clear calculator columns (set to NULL)
	//   - &CalculatorUpdate{Kind: &k, Data: d} → replace with validated document
	Calculator *CalculatorUpdate
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
	RecalculateAllGameElo(ctx context.Context) error

	// DeleteMarketAndRecalculate hard-deletes an open market and recalculates
	// Elo from the market's created_at date. Returns ErrMarketNotOpen if the
	// market is already resolved or cancelled.
	DeleteMarketAndRecalculate(ctx context.Context, marketID id.ID) error

	// Read-side queries used by the match list/detail handlers.
	ListMatchesWithPlayersPaginated(ctx context.Context, arg db.ListMatchesWithPlayersPaginatedParams) ([]db.ListMatchesWithPlayersPaginatedRow, error)
	GetMatchWithPlayers(ctx context.Context, matchID id.ID) ([]db.GetMatchWithPlayersRow, error)
	ListTournamentsByMatchIDs(ctx context.Context, matchIDs []id.ID) ([]db.ListTournamentsByMatchIDsRow, error)
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
			ctx, q, createdMatch.ID, gameID, playerScores,
			state, date,
			s.calculateAndStoreEloWithScores,
		); err != nil {
			return db.Match{}, err
		}

		if err := RecalculateBetLimits(ctx, q, playerIDs); err != nil {
			return db.Match{}, fmt.Errorf("recalculate bet limits: %w", err)
		}
	}

	playerIDs := playerIDsOf(playerScores)
	tournamentIDs, err := mergeWithActiveTournaments(ctx, q, date, playerIDs, opts.TournamentIDs)
	if err != nil {
		return db.Match{}, err
	}
	if err := applyMatchTournaments(ctx, q, createdMatch.ID, tournamentIDs, playerIDs); err != nil {
		return db.Match{}, err
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

	// Delete old scores and settlements to handle player list changes.
	// Explicit deletes are required because global_arena_settlement and game_arena_settlement
	// reference matches(id), not match_scores, so there is no cascade from match_scores.
	if err = q.DeleteGlobalArenaSettlementByMatch(ctx, &matchID); err != nil {
		return db.Match{}, fmt.Errorf("unable to delete global arena settlement for match %s: %w", matchID, err)
	}
	if err = q.DeleteGameArenaSettlementByMatch(ctx, &matchID); err != nil {
		return db.Match{}, fmt.Errorf("unable to delete game arena settlement for match %s: %w", matchID, err)
	}
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

	// Replace tournament associations with the provided set (an association can be
	// dropped when the date moves out of a tournament's window). Memberships are
	// only ever added — editing a match never removes tournament members.
	if err := q.DeleteMatchTournamentsByMatch(ctx, matchID); err != nil {
		return db.Match{}, fmt.Errorf("unable to clear match tournaments: %w", err)
	}
	playerIDs := playerIDsOf(playerScores)
	mergedTournamentIDs, err := mergeWithActiveTournaments(ctx, q, date, playerIDs, opts.TournamentIDs)
	if err != nil {
		return db.Match{}, err
	}
	if err := applyMatchTournaments(ctx, q, matchID, mergedTournamentIDs, playerIDs); err != nil {
		return db.Match{}, err
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

// RecalculateAllGameElo recalculates game Elo for all matches from the beginning of time.
// Used as a one-time backfill after the game Elo columns were added.
func (s *MatchService) RecalculateAllGameElo(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	if err := s.recalculateEloFromDate(ctx, q, time.Time{}); err != nil {
		return err
	}

	return tx.Commit(ctx)
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

	if err := q.DeleteGlobalArenaSettlementByMarket(ctx, &marketID); err != nil {
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

// lockAndGetPrevElos locks players in sorted order and returns all prior state
// needed to compute dual-track (elo + rating) and league settlements.
func (s *MatchService) lockAndGetPrevElos(ctx context.Context, q *db.Queries, match db.Match, playerScores map[id.ID]float64) (MatchPrevState, error) {
	settingsRow, err := q.GetEloSettingsForDate(ctx, match.Date)
	if err != nil {
		return MatchPrevState{}, fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	state := MatchPrevState{
		Elo:        make(map[id.ID]float64),
		GameElo:    make(map[id.ID]float64),
		Rating:     make(map[id.ID]float64),
		GameRating: make(map[id.ID]float64),
		League:     make(map[id.ID]string),
		GameLeague: make(map[id.ID]string),
		Count6M:    make(map[id.ID]int),
		Count2M:    make(map[id.ID]int),
		Settings:   settings,
	}

	playerIDs := make([]id.ID, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	sortPlayerIDs(playerIDs)

	matchDate := match.Date
	date6MAgo := pgtype.Timestamptz{Time: match.Date.Time.Add(-6 * 30 * 24 * time.Hour), Valid: true}
	date2MAgo := pgtype.Timestamptz{Time: match.Date.Time.Add(-2 * 30 * 24 * time.Hour), Valid: true}

	for _, playerID := range playerIDs {
		_, err = q.LockPlayerForEloCalculation(ctx, playerID)
		if err != nil {
			return MatchPrevState{}, fmt.Errorf("unable to lock player %s: %w", playerID, err)
		}

		prevGlobalElo, err := q.GetPlayerLatestGlobalEloBeforeMatch(ctx, db.GetPlayerLatestGlobalEloBeforeMatchParams{
			PlayerID: playerID,
			Date:     matchDate,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.Elo[playerID] = settings.StartingElo
		} else {
			state.Elo[playerID] = prevGlobalElo
		}

		prevGameElo, err := q.GetPlayerLatestGameEloBeforeMatch(ctx, db.GetPlayerLatestGameEloBeforeMatchParams{
			PlayerID: playerID,
			GameID:   match.GameID,
			Date:     matchDate,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.GameElo[playerID] = settings.StartingElo
		} else {
			state.GameElo[playerID] = prevGameElo
		}

		prevGlobalRating, err := q.GetPlayerLatestGlobalRatingBeforeMatch(ctx, db.GetPlayerLatestGlobalRatingBeforeMatchParams{
			PlayerID: playerID,
			Date:     matchDate,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.Rating[playerID] = settings.StartingRatingGlobal
			state.League[playerID] = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
		} else {
			state.Rating[playerID] = prevGlobalRating.Rating
			state.League[playerID] = prevGlobalRating.League
		}

		prevGameRating, err := q.GetPlayerLatestGameRatingBeforeMatch(ctx, db.GetPlayerLatestGameRatingBeforeMatchParams{
			PlayerID: playerID,
			GameID:   match.GameID,
			Date:     matchDate,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.GameRating[playerID] = settings.StartingRatingGame
			state.GameLeague[playerID] = initialLeagueForStarting(settings.StartingRatingGame, settings.StartingElo, settings)
		} else {
			state.GameRating[playerID] = prevGameRating.GameRatingAfter
			state.GameLeague[playerID] = prevGameRating.League
		}

		// counts before this match = total up to matchDate minus 1 (the match itself)
		count6M, err := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
			PlayerID: playerID,
			Date:     date6MAgo,
			Date_2:   matchDate,
		})
		if err != nil {
			state.Count6M[playerID] = 0
		} else {
			state.Count6M[playerID] = int(count6M)
		}

		count2M, err := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
			PlayerID: playerID,
			Date:     date2MAgo,
			Date_2:   matchDate,
		})
		if err != nil {
			state.Count2M[playerID] = 0
		} else {
			state.Count2M[playerID] = int(count2M)
		}

		// Resolve stale elite: if stored league says 'elite' but current counts
		// (before this match) don't meet thresholds, treat prevLeague as 'amateur'.
		// count6M/count2M here include the current match; subtract 1 to get pre-match counts.
		cnt60Before := state.Count2M[playerID] - 1
		cnt180Before := state.Count6M[playerID] - 1
		if cnt60Before < 0 {
			cnt60Before = 0
		}
		if cnt180Before < 0 {
			cnt180Before = 0
		}
		state.League[playerID] = effectiveLeague(state.League[playerID], cnt60Before, cnt180Before, settings)
	}

	return state, nil
}

// eloCalcResult holds per-player dual-track Elo/rating deltas and new values for one match.
type eloCalcResult struct {
	eloStaked        float64
	eloEarned        float64
	newGlobalElo     float64
	ratingStaked     float64
	ratingEarned     float64
	newGlobalRating  float64
	newGlobalLeague  string
	gameEloStaked    float64
	gameEloEarned    float64
	newGameElo       float64
	gameRatingStaked float64
	gameRatingEarned float64
	newGameRating    float64
	newGameLeague    string
}

// isInNewbieLeague returns true if elo still exceeds rating by more than the amateur threshold.
// Condition is directional: player is newbie only while elo > rating + goalGap.
// When rating catches up (elo - rating <= goalGap) or overshoots, the gap condition is met.
// Shared by match and correction league determination functions.
func isInNewbieLeague(rating, elo float64, s EloSettings) bool {
	return elo-rating > s.NewbieLeagueGoalGap
}

// scaleRatingEarned amplifies rating_earned_raw when elo > rating (rating still catching up).
// Maps ratingEarnedRaw ∈ [0, K] to [earnedMin·t, K+(earnedMax−K)·t] where t depends on gap.
// When rating >= elo (caught up or overshot), earned is unchanged (standard Elo).
func scaleRatingEarned(ratingEarnedRaw, prevElo, prevRating float64, s EloSettings) float64 {
	if prevRating >= prevElo {
		return ratingEarnedRaw
	}
	gap := prevElo - prevRating
	t := 1 - math.Exp(-gap/s.NewbieLeagueEarnedTau)
	earnedMin := s.NewbieLeagueEarnedMin * t
	earnedMax := s.K + (s.NewbieLeagueEarnedMax-s.K)*t
	if s.K == 0 {
		return earnedMin
	}
	return earnedMin + (ratingEarnedRaw/s.K)*(earnedMax-earnedMin)
}

// scaleRatingStaked amplifies rating_staked when rating > elo (rating has overshot).
// Multiplies staked by stakedScale/K, where stakedScale increases with the overshoot gap.
// When rating <= elo (normal case), staked is unchanged (standard Elo).
func scaleRatingStaked(ratingStakedRaw, prevElo, prevRating float64, s EloSettings) float64 {
	if prevRating <= prevElo || s.K == 0 {
		return ratingStakedRaw
	}
	gap := prevRating - prevElo
	t := 1 - math.Exp(-gap/s.NewbieLeagueEarnedTau)
	stakedScale := s.K + (s.NewbieLeagueEarnedMax-s.K)*t
	return ratingStakedRaw * (stakedScale / s.K)
}

// initialLeagueForStarting returns the league for a player with no prior settlement.
func initialLeagueForStarting(startingRating, startingElo float64, s EloSettings) string {
	if startingElo-startingRating <= s.NewbieLeagueGoalGap {
		return "amateur"
	}
	return "newbie"
}

// effectiveLeague accounts for time-based demotion from elite to amateur.
// The stored league in a settlement record is set at write time; if a player's
// match counts have since dropped below the elite thresholds, they are effectively
// in amateur even if their last record says 'elite'.
func effectiveLeague(storedLeague string, cnt60, cnt180 int, s EloSettings) string {
	if storedLeague == "elite" {
		if cnt180 >= s.EliteMatches6M && cnt60 >= s.EliteMatches2M {
			return "elite"
		}
		return "amateur"
	}
	return storedLeague
}

// determineGlobalLeague returns the league a player is in AFTER a global-arena settlement.
// When a newbie's gap condition is met, the elite check is also applied immediately —
// a player who simultaneously satisfies both the amateur and elite thresholds goes straight to elite.
func determineGlobalLeague(prev string, newRating, newElo float64, count6M, count2M int, s EloSettings) string {
	if prev == "newbie" && isInNewbieLeague(newRating, newElo, s) {
		return "newbie"
	}
	if count6M >= s.EliteMatches6M && count2M >= s.EliteMatches2M {
		return "elite"
	}
	return "amateur"
}

// determineGameLeague returns the league a player is in AFTER a game-arena settlement.
func determineGameLeague(prev string, newRating, newElo float64, s EloSettings) string {
	if prev == "newbie" {
		if isInNewbieLeague(newRating, newElo, s) {
			return "newbie"
		}
		return "amateur"
	}
	return "amateur"
}

// buildEloResults computes the dual-track (elo + rating) settlement for every player in the match.
// Pure calculation — no DB writes.
func buildEloResults(playerScores map[id.ID]float64, state MatchPrevState) map[id.ID]eloCalcResult {
	s := state.Settings

	newGlobalElos := CalculateNewElo(state.Elo, s.StartingElo, playerScores, s.K, s.D, s.WinReward)
	newGameElos := CalculateNewElo(state.GameElo, s.StartingElo, playerScores, s.K, s.D, s.WinReward)
	absoluteLoserScore := GetAbsoluteLoserScore(playerScores)

	results := make(map[id.ID]eloCalcResult, len(playerScores))
	for pid, score := range playerScores {
		// Global elo track
		eloStaked := -s.K * WinExpectation(state.Elo[pid], playerScores, s.StartingElo, state.Elo, s.D)
		eloEarned := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)

		// Global rating track: player's own rating replaces their elo in WinExpectation;
		// earned is scaled by gap between true elo and display rating (ADR-03).
		prevEloForRating := make(map[id.ID]float64, len(state.Elo))
		for k, v := range state.Elo {
			prevEloForRating[k] = v
		}
		prevEloForRating[pid] = state.Rating[pid]

		ratingStakedRaw := -s.K * WinExpectation(state.Rating[pid], playerScores, s.StartingElo, prevEloForRating, s.D)
		ratingStaked := scaleRatingStaked(ratingStakedRaw, state.Elo[pid], state.Rating[pid], s)
		ratingEarnedRaw := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)
		ratingEarned := scaleRatingEarned(ratingEarnedRaw, state.Elo[pid], state.Rating[pid], s)
		newGlobalRating := state.Rating[pid] + ratingStaked + ratingEarned
		newGlobalLeague := determineGlobalLeague(state.League[pid], newGlobalRating, newGlobalElos[pid], state.Count6M[pid], state.Count2M[pid], s)

		// Game elo track
		gameEloStaked := -s.K * WinExpectation(state.GameElo[pid], playerScores, s.StartingElo, state.GameElo, s.D)
		gameEloEarned := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)

		// Game rating track: same earned-scaling approach as global rating track.
		prevGameEloForRating := make(map[id.ID]float64, len(state.GameElo))
		for k, v := range state.GameElo {
			prevGameEloForRating[k] = v
		}
		prevGameEloForRating[pid] = state.GameRating[pid]

		gameRatingStakedRaw := -s.K * WinExpectation(state.GameRating[pid], playerScores, s.StartingElo, prevGameEloForRating, s.D)
		gameRatingStaked := scaleRatingStaked(gameRatingStakedRaw, state.GameElo[pid], state.GameRating[pid], s)
		gameRatingEarnedRaw := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)
		gameRatingEarned := scaleRatingEarned(gameRatingEarnedRaw, state.GameElo[pid], state.GameRating[pid], s)
		newGameRating := state.GameRating[pid] + gameRatingStaked + gameRatingEarned
		newGameLeague := determineGameLeague(state.GameLeague[pid], newGameRating, newGameElos[pid], s)

		results[pid] = eloCalcResult{
			eloStaked:        eloStaked,
			eloEarned:        eloEarned,
			newGlobalElo:     newGlobalElos[pid],
			ratingStaked:     ratingStaked,
			ratingEarned:     ratingEarned,
			newGlobalRating:  newGlobalRating,
			newGlobalLeague:  newGlobalLeague,
			gameEloStaked:    gameEloStaked,
			gameEloEarned:    gameEloEarned,
			newGameElo:       newGameElos[pid],
			gameRatingStaked: gameRatingStaked,
			gameRatingEarned: gameRatingEarned,
			newGameRating:    newGameRating,
			newGameLeague:    newGameLeague,
		}
	}
	return results
}

// calculateAndStoreEloWithScores inserts match_scores then upserts both settlement tables.
// Used by AddMatch to write scores and Elo for a brand-new match.
func (s *MatchService) calculateAndStoreEloWithScores(ctx context.Context, q *db.Queries, matchID id.ID, gameID id.ID, playerScores map[id.ID]float64, state MatchPrevState) error {
	results := buildEloResults(playerScores, state)

	for playerID, score := range playerScores {
		r := results[playerID]
		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
		}); err != nil {
			return fmt.Errorf("unable to upsert match score for player %s: %w", playerID, err)
		}
		if err := q.UpsertGlobalArenaSettlementByMatch(ctx, db.UpsertGlobalArenaSettlementByMatchParams{
			ID:           newSettlementID(),
			MatchID:      &matchID,
			PlayerID:     playerID,
			RatingAfter:  r.newGlobalRating,
			EloAfter:     r.newGlobalElo,
			EloStaked:    r.eloStaked,
			EloEarned:    r.eloEarned,
			RatingStaked: r.ratingStaked,
			RatingEarned: r.ratingEarned,
			League:       r.newGlobalLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert global arena settlement for player %s: %w", playerID, err)
		}
		if err := q.UpsertGameArenaSettlementByMatch(ctx, db.UpsertGameArenaSettlementByMatchParams{
			ID:           newSettlementID(),
			MatchID:      &matchID,
			GameID:       gameID,
			PlayerID:     playerID,
			RatingAfter:  r.newGameRating,
			EloAfter:     r.newGameElo,
			EloStaked:    r.gameEloStaked,
			EloEarned:    r.gameEloEarned,
			RatingStaked: r.gameRatingStaked,
			RatingEarned: r.gameRatingEarned,
			League:       r.newGameLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert game arena settlement for player %s: %w", playerID, err)
		}
	}

	return nil
}

// calculateAndUpdateElo upserts settlement records without touching match_scores.
// Used by recalculation paths where scores already exist.
func (s *MatchService) calculateAndUpdateElo(ctx context.Context, q *db.Queries, matchID id.ID, gameID id.ID, playerScores map[id.ID]float64, state MatchPrevState) error {
	results := buildEloResults(playerScores, state)

	for playerID := range playerScores {
		r := results[playerID]
		if err := q.UpsertGlobalArenaSettlementByMatch(ctx, db.UpsertGlobalArenaSettlementByMatchParams{
			ID:           newSettlementID(),
			MatchID:      &matchID,
			PlayerID:     playerID,
			RatingAfter:  r.newGlobalRating,
			EloAfter:     r.newGlobalElo,
			EloStaked:    r.eloStaked,
			EloEarned:    r.eloEarned,
			RatingStaked: r.ratingStaked,
			RatingEarned: r.ratingEarned,
			League:       r.newGlobalLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert global arena settlement for player %s: %w", playerID, err)
		}
		if err := q.UpsertGameArenaSettlementByMatch(ctx, db.UpsertGameArenaSettlementByMatchParams{
			ID:           newSettlementID(),
			MatchID:      &matchID,
			GameID:       gameID,
			PlayerID:     playerID,
			RatingAfter:  r.newGameRating,
			EloAfter:     r.newGameElo,
			EloStaked:    r.gameEloStaked,
			EloEarned:    r.gameEloEarned,
			RatingStaked: r.gameRatingStaked,
			RatingEarned: r.gameRatingEarned,
			League:       r.newGameLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert game arena settlement for player %s: %w", playerID, err)
		}
	}

	return nil
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

// mergeWithActiveTournaments unions the explicitly-requested tournament IDs with
// every tournament active on the match date whose membership already contains all
// match players. This enforces the invariant "if all players are members of a
// currently-running tournament, the match belongs to it" for every save path
// (forms, calculators, offline sync) without the client having to compute it.
func mergeWithActiveTournaments(ctx context.Context, q *db.Queries, date time.Time, playerIDs []id.ID, explicit []id.ID) ([]id.ID, error) {
	auto, err := q.ListActiveTournamentsForPlayers(ctx, db.ListActiveTournamentsForPlayersParams{
		At:        date,
		PlayerIds: playerIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("auto-detect active tournaments: %w", err)
	}

	seen := make(map[id.ID]struct{}, len(explicit)+len(auto))
	merged := make([]id.ID, 0, len(explicit)+len(auto))
	for _, tid := range explicit {
		if _, ok := seen[tid]; !ok {
			seen[tid] = struct{}{}
			merged = append(merged, tid)
		}
	}
	for _, tid := range auto {
		if _, ok := seen[tid]; !ok {
			seen[tid] = struct{}{}
			merged = append(merged, tid)
		}
	}
	return merged, nil
}

// applyMatchTournaments associates the match with each tournament and auto-enrols
// every match player into them. Memberships use ON CONFLICT DO NOTHING and are
// never removed here (per ADR: editing a match never removes tournament members).
func applyMatchTournaments(ctx context.Context, q *db.Queries, matchID id.ID, tournamentIDs []id.ID, playerIDs []id.ID) error {
	for _, tid := range tournamentIDs {
		if err := q.AddMatchTournament(ctx, db.AddMatchTournamentParams{MatchID: matchID, TournamentID: tid}); err != nil {
			return fmt.Errorf("associate match %s with tournament %s: %w", matchID, tid, err)
		}
		for _, pid := range playerIDs {
			if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: tid, PlayerID: pid}); err != nil {
				return fmt.Errorf("enrol player %s into tournament %s: %w", pid, tid, err)
			}
		}
	}
	return nil
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

// ListTournamentsByMatchIDs returns the tournament memberships for a set of
// matches; used by both the list and detail handlers.
func (s *MatchService) ListTournamentsByMatchIDs(ctx context.Context, matchIDs []id.ID) ([]db.ListTournamentsByMatchIDsRow, error) {
	return s.Queries.ListTournamentsByMatchIDs(ctx, matchIDs)
}
