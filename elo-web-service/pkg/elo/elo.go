package elo

import (
	"maps"
	"math"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// newSettlementID mints a server-generated UUIDv7 for settlement rows.
// Settlement ids are server-generated (ADR-06 §"server-generated ids"): the
// client never supplies them. UUIDv7 keeps them lexicographically sortable by
// creation time, which the settlement-ordering queries (ORDER BY date, id)
// rely on for the equal-date tie-break (ADR-01 §22).
func newSettlementID() id.ID {
	return id.New()
}

func WinExpectation(currentElo float64, playersScore map[id.ID]float64, startingElo float64,
	prevElo map[id.ID]float64, elo_const_d float64) float64 {

	var playersCount float64 = float64(len(playersScore))
	if playersCount == 1 {
		return 1
	}

	var sum float64 = 0
	for p := range playersScore {
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
	for _, s := range playersScore {
		sumPow += math.Pow(s-absoluteLoserScore, winReward)
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
