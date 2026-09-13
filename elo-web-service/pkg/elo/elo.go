package elo

import (
	"maps"
	"math"
	"slices"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// newSettlementID mints a server-generated UUIDv7 for settlement rows.
// Settlement ids are server-generated (ADR-06 §"server-generated ids"): the
// client never supplies them. The ids are monotonic within the process —
// id order equals creation order even within one millisecond — which the
// settlement-ordering queries rely on for the equal-date (date, id) tie-break
// (ADR-01 §22): a replay must reproduce its own write order, or a later
// same-date read silently picks an older settlement row.
func newSettlementID() id.ID {
	return id.NewMonotonic()
}

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

func CalculateNewElo(previousElo map[id.ID]float64, startingElo float64, score map[id.ID]float64,
	eloConstK float64, eloConstD float64, winReward float64) map[id.ID]float64 {

	newElo := make(map[id.ID]float64, len(previousElo))
	maps.Copy(newElo, previousElo)

	absoluteLoserScore := GetAbsoluteLoserScore(score)

	// for every player in this match calculate new elo
	for pid, sc := range score {
		// previous elo or starting elo if not present
		prev := startingElo
		if v, ok := previousElo[pid]; ok {
			prev = v
		}

		norm := NormalizedScore(sc, score, absoluteLoserScore, winReward)
		expect := WinExpectation(prev, score, startingElo, previousElo, eloConstD)

		delta := eloConstK * (norm - expect)
		newElo[pid] = prev + delta
	}
	return newElo
}
