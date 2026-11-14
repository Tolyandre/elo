package elo

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/settlement"
)

// ArenaPrevState is the per-player prior state of one match in one arena.
// The struct lives in pkg/settlement; the alias keeps the historical name.
type ArenaPrevState = settlement.ArenaPrevState

// ---------------------------------------------------------------------------
// League progression wrappers. The logic lives in pkg/settlement (one
// implementation of the math) and the arena-taking signatures below are the
// historical in-package shape.
// ---------------------------------------------------------------------------

// arenaLeaguePriority orders leagues for ranking: lower = ranked higher.
func arenaLeaguePriority(league *string, arena Arena) int {
	return settlement.ArenaLeaguePriority(league, arena.Settings)
}

// initialArenaLeague returns the league for a player with no prior settlement
// in the arena.
func initialArenaLeague(arena Arena, s EloSettings) *string {
	return settlement.InitialArenaLeague(arena.Settings, s)
}

// effectiveArenaLeague accounts for time-based demotion from elite: the
// stored league is set at write time; if the player's recent match counts have
// dropped below the elite thresholds they are effectively in the base league.
func effectiveArenaLeague(stored *string, cnt60, cnt180 int, arena Arena) *string {
	return settlement.EffectiveArenaLeague(stored, cnt60, cnt180, arena.Settings)
}

// displayLeague is the league a players listing shows: unsettled players
// derive from the starting values, settled players get the stale-elite
// correction.
func displayLeague(stored *string, settled bool, cnt60, cnt180 int, arena Arena, s EloSettings) string {
	return settlement.DisplayLeague(stored, settled, cnt60, cnt180, arena.Settings, s)
}

// determineArenaLeague returns the league a player is in AFTER a settlement.
func determineArenaLeague(prev *string, newRating, newElo float64, count6M, count2M int, arena Arena) *string {
	return settlement.DetermineArenaLeague(prev, newRating, newElo, count6M, count2M, arena.Settings)
}

// ---------------------------------------------------------------------------
// Per-match settlement calculation (DB-facing halves; the pure math is
// settlement.BuildArenaResults).
// ---------------------------------------------------------------------------

// lockAndGetPrevArenaState locks the match's players in sorted order and
// returns each player's prior state in the given arena. The current match is
// already persisted (row + scores) when this runs, so the period counts
// include it — the same convention the pre-rework code used.
func lockAndGetPrevArenaState(
	ctx context.Context, q *db.Queries, arena Arena, match db.Match, playerScores map[id.ID]float64,
) (ArenaPrevState, error) {
	settingsRow, err := q.GetEloSettingsForDate(ctx, match.Date)
	if err != nil {
		return ArenaPrevState{}, fmt.Errorf("get elo settings: %w", err)
	}
	s := EloSettingsFromDB(settingsRow)

	state := ArenaPrevState{
		Elo:      make(map[id.ID]float64, len(playerScores)),
		Rating:   make(map[id.ID]float64, len(playerScores)),
		League:   make(map[id.ID]*string, len(playerScores)),
		Count6M:  make(map[id.ID]int, len(playerScores)),
		Count2M:  make(map[id.ID]int, len(playerScores)),
		Settings: s,
	}

	playerIDs := make([]id.ID, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Slice(playerIDs, func(i, j int) bool { return playerIDs[i] < playerIDs[j] })

	date6MAgo := match.Date.Time.Add(-6 * 30 * 24 * time.Hour)
	date2MAgo := match.Date.Time.Add(-2 * 30 * 24 * time.Hour)

	for _, playerID := range playerIDs {
		if _, err = q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
			return ArenaPrevState{}, fmt.Errorf("unable to lock player %s: %w", playerID, err)
		}

		prevElo, err := q.GetPlayerLatestArenaEloBeforeMatch(ctx, db.GetPlayerLatestArenaEloBeforeMatchParams{
			ArenaID:  arena.ID,
			PlayerID: playerID,
			Date:     match.Date,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.Elo[playerID] = s.StartingElo
		} else {
			state.Elo[playerID] = prevElo
		}

		prevRating, err := q.GetPlayerLatestArenaRatingBeforeMatch(ctx, db.GetPlayerLatestArenaRatingBeforeMatchParams{
			ArenaID:  arena.ID,
			PlayerID: playerID,
			Date:     match.Date,
			MatchID:  &match.ID,
		})
		if err != nil {
			state.Rating[playerID] = arena.Settings.StartingRating
			state.League[playerID] = initialArenaLeague(arena, s)
		} else {
			state.Rating[playerID] = prevRating.Rating
			state.League[playerID] = textPtr(prevRating.League)
		}

		count6M, err := q.CountPlayerMatchesInArenaInPeriod(ctx, db.CountPlayerMatchesInArenaInPeriodParams{
			ArenaID:  arena.ID,
			PlayerID: playerID,
			DateFrom: date6MAgo,
			DateTo:   match.Date.Time,
		})
		if err != nil {
			state.Count6M[playerID] = 0
		} else {
			state.Count6M[playerID] = int(count6M)
		}

		count2M, err := q.CountPlayerMatchesInArenaInPeriod(ctx, db.CountPlayerMatchesInArenaInPeriodParams{
			ArenaID:  arena.ID,
			PlayerID: playerID,
			DateFrom: date2MAgo,
			DateTo:   match.Date.Time,
		})
		if err != nil {
			state.Count2M[playerID] = 0
		} else {
			state.Count2M[playerID] = int(count2M)
		}

		// Resolve stale elite with pre-match counts (the counts above include
		// the current match).
		cnt60 := max(state.Count2M[playerID]-1, 0)
		cnt180 := max(state.Count6M[playerID]-1, 0)
		state.League[playerID] = effectiveArenaLeague(state.League[playerID], cnt60, cnt180, arena)
	}

	return state, nil
}

// storeArenaMatchSettlements computes and persists one match's settlements in
// the given arena. Players are written in sorted id order so the monotonic
// settlement ids reproduce a stable (date, id) event order across replays.
func storeArenaMatchSettlements(
	ctx context.Context, q *db.Queries, arena Arena, match db.Match,
	playerScores map[id.ID]float64, prev ArenaPrevState,
) error {
	results := settlement.BuildArenaResults(playerScores, prev, arena.Settings)

	playerIDs := make([]id.ID, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Slice(playerIDs, func(i, j int) bool { return playerIDs[i] < playerIDs[j] })

	for _, playerID := range playerIDs {
		r := results[playerID]
		if err := q.UpsertArenaSettlementByMatch(ctx, db.UpsertArenaSettlementByMatchParams{
			ID:           newSettlementID(),
			ArenaID:      arena.ID,
			PlayerID:     playerID,
			Date:         match.Date,
			RatingAfter:  r.NewRating,
			EloAfter:     r.NewElo,
			MatchID:      &match.ID,
			EloStaked:    r.EloStaked,
			EloEarned:    r.EloEarned,
			RatingStaked: r.RatingStaked,
			RatingEarned: r.RatingEarned,
			League:       ptrText(r.League),
		}); err != nil {
			return fmt.Errorf("unable to upsert arena settlement for player %s: %w", playerID, err)
		}
	}
	return nil
}
