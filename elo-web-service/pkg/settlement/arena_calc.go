package settlement

import (
	"maps"

	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/ratingmath"
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

// PlayerResult holds one player's dual-track deltas and new values for
// one match in one arena.
type PlayerResult struct {
	EloStaked    float64 `json:"elo_staked"`
	EloEarned    float64 `json:"elo_earned"`
	NewElo       float64 `json:"new_elo"`
	RatingStaked float64 `json:"rating_staked"`
	RatingEarned float64 `json:"rating_earned"`
	NewRating    float64 `json:"new_rating"`
	League       *string `json:"league"`
}

// ScaleRatingEarned amplifies rating_earned when elo > rating (rating still
// catching up). Maps ratingEarnedRaw ∈ [0, K] to [earnedMin·t, K+(earnedMax−K)·t]
// where t depends on the gap. When rating >= elo, earned is unchanged.
func ScaleRatingEarned(ratingEarnedRaw, prevElo, prevRating float64, cu CatchUp, s EloSettings) float64 {
	if prevRating >= prevElo {
		return ratingEarnedRaw
	}
	gap := prevElo - prevRating
	t := 1 - expDeterministic(-gap/cu.Tau)
	earnedMin := cu.EarnedMin * t
	earnedMax := s.K + (cu.EarnedMax-s.K)*t
	if s.K == 0 {
		return earnedMin
	}
	return earnedMin + (ratingEarnedRaw/s.K)*(earnedMax-earnedMin)
}

// ScaleRatingStaked amplifies rating_staked when rating > elo (rating has
// overshot). When rating <= elo, staked is unchanged.
func ScaleRatingStaked(ratingStakedRaw, prevElo, prevRating float64, cu CatchUp, s EloSettings) float64 {
	if prevRating <= prevElo || s.K == 0 {
		return ratingStakedRaw
	}
	gap := prevRating - prevElo
	t := 1 - expDeterministic(-gap/cu.Tau)
	stakedScale := s.K + (cu.EarnedMax-s.K)*t
	return ratingStakedRaw * (stakedScale / s.K)
}

// BuildArenaResults computes the dual-track (elo + rating) settlement for
// every player in the match, in the given arena. Pure calculation — no DB
// writes. The catch-up scaling always applies (it is a no-op while
// rating >= elo), so an arena whose starting rating equals the starting elo
// has rating ≡ elo: the two tracks mirror each other exactly. With a lower
// starting rating the visible rating catches up to elo through the scaled
// earned — with or without leagues.
func BuildArenaResults(playerScores map[id.ID]float64, prev ArenaPrevState, settings ArenaSettings) map[id.ID]PlayerResult {
	s := prev.Settings

	newElos := CalculateNewElo(prev.Elo, s.StartingElo, playerScores, s.K, s.D, s.WinReward)
	absoluteLoserScore := ratingmath.GetAbsoluteLoserScore(playerScores)

	results := make(map[id.ID]PlayerResult, len(playerScores))
	for pid, score := range playerScores {
		// Elo track.
		eloStaked := -s.K * WinExpectation(prev.Elo[pid], playerScores, s.StartingElo, prev.Elo, s.D)
		eloEarned := s.K * ratingmath.NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)

		// Rating track: the player's own rating replaces their elo in
		// WinExpectation; earned/staked are scaled by the elo↔rating gap.
		prevEloForRating := make(map[id.ID]float64, len(prev.Elo))
		maps.Copy(prevEloForRating, prev.Elo)
		prevEloForRating[pid] = prev.Rating[pid]

		ratingStakedRaw := -s.K * WinExpectation(prev.Rating[pid], playerScores, s.StartingElo, prevEloForRating, s.D)
		ratingEarnedRaw := s.K * ratingmath.NormalizedScore(score, playerScores, absoluteLoserScore, s.WinReward)
		ratingStaked := ScaleRatingStaked(ratingStakedRaw, prev.Elo[pid], prev.Rating[pid], settings.CatchUp, s)
		ratingEarned := ScaleRatingEarned(ratingEarnedRaw, prev.Elo[pid], prev.Rating[pid], settings.CatchUp, s)
		newRating := prev.Rating[pid] + ratingStaked + ratingEarned
		league := DetermineArenaLeague(prev.League[pid], newRating, newElos[pid], prev.Count6M[pid], prev.Count2M[pid], settings)

		results[pid] = PlayerResult{
			EloStaked:    eloStaked,
			EloEarned:    eloEarned,
			NewElo:       newElos[pid],
			RatingStaked: ratingStaked,
			RatingEarned: ratingEarned,
			NewRating:    newRating,
			League:       league,
		}
	}
	return results
}
