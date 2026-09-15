package elo

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ArenaPrevState bundles the per-player prior state needed to compute one
// match's settlements in ONE arena.
type ArenaPrevState struct {
	Elo     map[id.ID]float64 // true Elo before this match
	Rating  map[id.ID]float64 // display rating before this match
	League  map[id.ID]*string // league before this match (nil when arena has no leagues)
	Count6M map[id.ID]int     // arena matches in the last 6 months (includes this match)
	Count2M map[id.ID]int     // arena matches in the last 2 months (includes this match)

	Settings EloSettings // K/D/starting_elo/win_reward at the match date
}

// arenaPlayerResult holds one player's dual-track deltas and new values for
// one match in one arena.
type arenaPlayerResult struct {
	eloStaked    float64
	eloEarned    float64
	newElo       float64
	ratingStaked float64
	ratingEarned float64
	newRating    float64
	league       *string
}

// ---------------------------------------------------------------------------
// League progression, driven by the arena's settings league list (ADR-24).
// The list is in promotion order and must be a subsequence of
// newbie → amateur → elite (enforced by arenasettings.Parse).
// ---------------------------------------------------------------------------

func strPtr(s string) *string { return &s }

// arenaLeaguePriority orders leagues for ranking: lower = ranked higher.
// The settings list is in promotion order (newbie → amateur → elite), so the
// priority inverts it: elite sorts first. League-less arenas put everyone in
// one bucket (all equal, ties broken by rating).
func arenaLeaguePriority(league *string, arena Arena) int {
	if league == nil {
		return len(arena.Settings.Leagues)
	}
	for i, l := range arena.Settings.Leagues {
		if l.Kind == *league {
			return len(arena.Settings.Leagues) - 1 - i
		}
	}
	return len(arena.Settings.Leagues)
}

// baseLeague returns the highest non-elite league (the tier players settle in
// when they leave newbie and do not qualify for elite).
func baseLeague(arena Arena) string {
	for i := len(arena.Settings.Leagues) - 1; i >= 0; i-- {
		if arena.Settings.Leagues[i].Kind != LeagueElite {
			return arena.Settings.Leagues[i].Kind
		}
	}
	return arena.Settings.Leagues[len(arena.Settings.Leagues)-1].Kind
}

// initialArenaLeague returns the league for a player with no prior settlement
// in the arena. Players whose starting gap exceeds the newbie threshold start
// as newbies (ADR-03); when the arena has no newbie league they start in the
// first league.
func initialArenaLeague(arena Arena, s EloSettings) *string {
	if len(arena.Settings.Leagues) == 0 {
		return nil
	}
	if nl, ok := arena.Settings.Newbie(); ok {
		if s.StartingElo-arena.Settings.StartingRating > nl.GoalGap {
			return strPtr(LeagueNewbie)
		}
	}
	for _, l := range arena.Settings.Leagues {
		if l.Kind != LeagueNewbie {
			return strPtr(l.Kind)
		}
	}
	return strPtr(LeagueNewbie)
}

// effectiveArenaLeague accounts for time-based demotion from elite: the
// stored league is set at write time; if the player's recent match counts have
// dropped below the elite thresholds they are effectively in the base league.
func effectiveArenaLeague(stored *string, cnt60, cnt180 int, arena Arena) *string {
	if stored == nil {
		return nil
	}
	if *stored == LeagueElite {
		if el, ok := arena.Settings.Elite(); ok && cnt180 >= el.Matches6M && cnt60 >= el.Matches2M {
			return stored
		}
		return strPtr(baseLeague(arena))
	}
	return stored
}

// determineArenaLeague returns the league a player is in AFTER a settlement.
// A newbie stays while the elo−rating gap exceeds the newbie goal; the elite
// check applies immediately when the counts qualify (a promoted newbie can
// jump straight to elite); everyone else lands in the base league.
func determineArenaLeague(prev *string, newRating, newElo float64, count6M, count2M int, arena Arena) *string {
	if len(arena.Settings.Leagues) == 0 {
		return nil
	}
	if nl, ok := arena.Settings.Newbie(); ok {
		if prev != nil && *prev == LeagueNewbie && newElo-newRating > nl.GoalGap {
			return strPtr(LeagueNewbie)
		}
	}
	if el, ok := arena.Settings.Elite(); ok {
		if count6M >= el.Matches6M && count2M >= el.Matches2M {
			return strPtr(LeagueElite)
		}
	}
	return strPtr(baseLeague(arena))
}

// determineCorrectionLeague returns the league after a manual rating
// correction. Corrections can demote any player to newbie (a correction may
// re-open the elo−rating gap), unlike match settlements which only keep
// newbies in the newbie league.
func determineCorrectionLeague(prev *string, newRating, prevElo float64, arena Arena) *string {
	if len(arena.Settings.Leagues) == 0 {
		return nil
	}
	if nl, ok := arena.Settings.Newbie(); ok {
		if prevElo-newRating > nl.GoalGap {
			return strPtr(LeagueNewbie)
		}
	}
	if prev != nil && *prev == LeagueNewbie {
		for _, l := range arena.Settings.Leagues {
			if l.Kind != LeagueNewbie {
				return strPtr(l.Kind)
			}
		}
		return strPtr(LeagueNewbie)
	}
	return prev
}

// ---------------------------------------------------------------------------
// Newbie rating scaling (ADR-03), parameterized by the arena's newbie league.
// ---------------------------------------------------------------------------

// scaleRatingEarned amplifies rating_earned when elo > rating (rating still
// catching up). Maps ratingEarnedRaw ∈ [0, K] to [earnedMin·t, K+(earnedMax−K)·t]
// where t depends on the gap. When rating >= elo, earned is unchanged.
func scaleRatingEarned(ratingEarnedRaw, prevElo, prevRating float64, nl arenasettings.League, s EloSettings) float64 {
	if prevRating >= prevElo {
		return ratingEarnedRaw
	}
	gap := prevElo - prevRating
	t := 1 - math.Exp(-gap/nl.Tau)
	earnedMin := nl.EarnedMin * t
	earnedMax := s.K + (nl.EarnedMax-s.K)*t
	if s.K == 0 {
		return earnedMin
	}
	return earnedMin + (ratingEarnedRaw/s.K)*(earnedMax-earnedMin)
}

// scaleRatingStaked amplifies rating_staked when rating > elo (rating has
// overshot). When rating <= elo, staked is unchanged.
func scaleRatingStaked(ratingStakedRaw, prevElo, prevRating float64, nl arenasettings.League, s EloSettings) float64 {
	if prevRating <= prevElo || s.K == 0 {
		return ratingStakedRaw
	}
	gap := prevRating - prevElo
	t := 1 - math.Exp(-gap/nl.Tau)
	stakedScale := s.K + (nl.EarnedMax-s.K)*t
	return ratingStakedRaw * (stakedScale / s.K)
}

// ---------------------------------------------------------------------------
// Per-match settlement calculation
// ---------------------------------------------------------------------------

// buildArenaResults computes the dual-track (elo + rating) settlement for
// every player in the match, in the given arena. Pure calculation — no DB
// writes. An arena without a newbie league has rating ≡ elo: the rating track
// receives no scaling and (with starting rating = starting elo) mirrors the
// elo track exactly.
func buildArenaResults(playerScores map[id.ID]float64, prev ArenaPrevState, arena Arena) map[id.ID]arenaPlayerResult {
	s := prev.Settings

	newElos := CalculateNewElo(prev.Elo, s.StartingElo, playerScores, s.K, s.D, s.WinReward)
	absoluteLoserScore := GetAbsoluteLoserScore(playerScores)
	nl, hasNewbie := arena.Settings.Newbie()

	results := make(map[id.ID]arenaPlayerResult, len(playerScores))
	for pid, score := range playerScores {
		// Elo track.
		eloStaked := -s.K * WinExpectation(prev.Elo[pid], playerScores, s.StartingElo, prev.Elo, s.D)
		eloEarned := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)

		// Rating track: the player's own rating replaces their elo in
		// WinExpectation; earned/staked are scaled by the elo↔rating gap.
		prevEloForRating := make(map[id.ID]float64, len(prev.Elo))
		for k, v := range prev.Elo {
			prevEloForRating[k] = v
		}
		prevEloForRating[pid] = prev.Rating[pid]

		ratingStakedRaw := -s.K * WinExpectation(prev.Rating[pid], playerScores, s.StartingElo, prevEloForRating, s.D)
		ratingEarnedRaw := s.K * NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)
		ratingStaked, ratingEarned := ratingStakedRaw, ratingEarnedRaw
		if hasNewbie {
			ratingStaked = scaleRatingStaked(ratingStakedRaw, prev.Elo[pid], prev.Rating[pid], nl, s)
			ratingEarned = scaleRatingEarned(ratingEarnedRaw, prev.Elo[pid], prev.Rating[pid], nl, s)
		}
		newRating := prev.Rating[pid] + ratingStaked + ratingEarned
		league := determineArenaLeague(prev.League[pid], newRating, newElos[pid], prev.Count6M[pid], prev.Count2M[pid], arena)

		results[pid] = arenaPlayerResult{
			eloStaked:    eloStaked,
			eloEarned:    eloEarned,
			newElo:       newElos[pid],
			ratingStaked: ratingStaked,
			ratingEarned: ratingEarned,
			newRating:    newRating,
			league:       league,
		}
	}
	return results
}

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
	results := buildArenaResults(playerScores, prev, arena)

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
			RatingAfter:  r.newRating,
			EloAfter:     r.newElo,
			MatchID:      &match.ID,
			EloStaked:    r.eloStaked,
			EloEarned:    r.eloEarned,
			RatingStaked: r.ratingStaked,
			RatingEarned: r.ratingEarned,
			League:       ptrText(r.league),
		}); err != nil {
			return fmt.Errorf("unable to upsert arena settlement for player %s: %w", playerID, err)
		}
	}
	return nil
}
