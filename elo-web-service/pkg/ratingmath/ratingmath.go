// Package ratingmath holds the pure rating arithmetic shared by the Elo
// settlement (pkg/elo) and the tournament slot scoring (pkg/bracket): the
// W-normalized score share — the "earn part" of an Elo settlement — and the
// absolute loser score it is measured against. The leaf placement lets the
// bracket derive slot points from the exact formula the arena settles with,
// without a dependency cycle.
package ratingmath

import (
	"maps"
	"math"
	"slices"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// NormalizedScore returns the player's share of the match's earn pool: their
// score above the worst score, raised to the winReward power, divided by the
// same powered surplus summed over all players — a value in [0, 1]. The
// winReward exponent (elo_settings.win_reward) shapes how steeply a higher
// game score converts into a larger share. All-equal scores leave the share
// undefined (0/0) and fall back to the uniform 1/N.
func NormalizedScore(currentScore float64, playersScore map[id.ID]float64, absoluteLoserScore float64, winReward float64) float64 {
	var sumPow float64 = 0
	for _, p := range slices.Sorted(maps.Keys(playersScore)) {
		sumPow += math.Pow(playersScore[p]-absoluteLoserScore, winReward)
	}
	score := math.Pow(currentScore-absoluteLoserScore, winReward) / sumPow
	if math.IsNaN(score) {
		score = 1 / float64(len(playersScore))
	}
	return score
}

// GetAbsoluteLoserScore returns the smallest score in the map — the zero
// point the normalized shares are measured from.
func GetAbsoluteLoserScore(playersScore map[id.ID]float64) float64 {
	var minSet = false
	var min float64 = 0
	for _, s := range playersScore {
		if minSet {
			min = math.Min(min, s)
		} else {
			min = s
		}
		minSet = true
	}
	return min
}
