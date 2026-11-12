package settlement

import (
	"maps"
	"math"
	"slices"

	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/ratingmath"
)

func WinExpectation(currentElo float64, playersScore map[id.ID]float64, startingElo float64,
	prevElo map[id.ID]float64, elo_const_d float64) float64 {

	var playersCount float64 = float64(len(playersScore))
	if playersCount == 1 {
		return 1
	}

	// Sum over ids in sorted order: float addition is not associative and Go
	// randomizes map range order, so an unordered sum made multiplayer
	// settlements irreproducible at the last bits — a full replay drifted from
	// the stored state by ~1 ULP per multiplayer match, compounding over history.
	var sum float64 = 0
	for _, p := range slices.Sorted(maps.Keys(playersScore)) {
		prev := startingElo
		if v, ok := prevElo[p]; ok {
			prev = v
		}
		sum += 1 / (1 + math.Pow(10, (prev-currentElo)/elo_const_d))
	}

	return (sum - 0.5) / (playersCount * (playersCount - 1) / 2)
}

// NormalizedScore and GetAbsoluteLoserScore live in pkg/ratingmath: the
// tournament bracket derives slot points from the same earn-part arithmetic
// (ADR-30), and the leaf package keeps that shared without a cycle.

func CalculateNewElo(previousElo map[id.ID]float64, startingElo float64, score map[id.ID]float64,
	eloConstK float64, eloConstD float64, winReward float64) map[id.ID]float64 {

	newElo := make(map[id.ID]float64, len(previousElo))
	maps.Copy(newElo, previousElo)

	absoluteLoserScore := ratingmath.GetAbsoluteLoserScore(score)

	// for every player in this match calculate new elo
	for pid, sc := range score {
		// previous elo or starting elo if not present
		prev := startingElo
		if v, ok := previousElo[pid]; ok {
			prev = v
		}

		norm := ratingmath.NormalizedScore(sc, score, absoluteLoserScore, winReward)
		expect := WinExpectation(prev, score, startingElo, previousElo, eloConstD)

		delta := eloConstK * (norm - expect)
		newElo[pid] = prev + delta
	}
	return newElo
}
