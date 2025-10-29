package elo

import (
	"maps"
	"math"
)

const StartingElo = 1000

func WinExpectation(currentElo float64, playersScore map[string]float64, startingElo float64,
	prevElo map[string]float64, elo_const_d float64) float64 {

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

func NormalizedScore(currentScore float64, playersScore map[string]float64, absoluteLoserScore float64) float64 {
	var playersCount float64 = float64(len(playersScore))
	var sum float64 = 0
	for _, s := range playersScore {
		sum += s
	}

	var score = (currentScore - absoluteLoserScore) / (sum - absoluteLoserScore*playersCount)
	if math.IsNaN(score) {
		score = 1 / playersCount
	}

	return score
}

func GetAsboluteLoserScore(playersScore map[string]float64) float64 {
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

func CalculateNewElo(previousElo map[string]float64, startingElo float64, score map[string]float64,
	eloConstK float64, eloConstD float64) map[string]float64 {

	newElo := make(map[string]float64)
	maps.Copy(newElo, previousElo)

	absoluteLoserScore := GetAsboluteLoserScore(score)

	// for every player in this match calculate new elo
	for pid, sc := range score {
		// previous elo or starting elo if not present
		prev := startingElo
		if v, ok := previousElo[pid]; ok {
			prev = v
		}

		norm := NormalizedScore(sc, score, absoluteLoserScore)
		expect := WinExpectation(prev, score, startingElo, previousElo, eloConstD)

		delta := eloConstK * (norm - expect)
		newElo[pid] = prev + delta
	}
	return newElo
}
