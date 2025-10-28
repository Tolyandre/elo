package elo

import (
	"math"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func WinExpectation(currentElo float64, match *googlesheet.MatchRow, prevElo *googlesheet.EloRow, elo_const_d float64) float64 {
	var playersCount float64 = float64(len(match.PlayersScore))
	if playersCount == 1 {
		return 1
	}

	var sum float64 = 0
	for p := range match.PlayersScore {
		sum += 1 / (1 + math.Pow(10, (prevElo.PlayersElo[p]-currentElo)/elo_const_d))
	}

	return (sum - 0.5) / (playersCount * (playersCount - 1) / 2)
}

func NormalizedScore(currentScore float64, match *googlesheet.MatchRow, absoluteLoserScore float64) float64 {
	var playersCount float64 = float64(len(match.PlayersScore))
	var sum float64 = 0
	for _, s := range match.PlayersScore {
		sum += s
	}

	var score = (currentScore - absoluteLoserScore) / (sum - absoluteLoserScore*playersCount)
	if math.IsNaN(score) {
		score = 1 / playersCount
	}

	return score
}

func GetAsboluteLoserScore(match *googlesheet.MatchRow) float64 {
	var minSet = false
	var min float64 = 0
	for _, s := range match.PlayersScore {
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
	// copy previous elos so players not involved in this match keep their rating
	for id, e := range previousElo {
		newElo[id] = e
	}

	// build a lightweight match object so we can reuse helper functions
	match := &googlesheet.MatchRow{PlayersScore: score}

	absoluteLoserScore := GetAsboluteLoserScore(match)

	// for every player in this match calculate new elo
	playersCount := float64(len(score))
	for pid, sc := range score {
		// previous elo or starting elo if not present
		prev := startingElo
		if v, ok := previousElo[pid]; ok {
			prev = v
		}

		// normalized score for this player
		norm := NormalizedScore(sc, match, absoluteLoserScore)

		// compute win expectation using previous elos (or startingElo when missing)
		var sum float64 = 0
		for opp := range score {
			oppElo := startingElo
			if v, ok := previousElo[opp]; ok {
				oppElo = v
			}
			sum += 1 / (1 + math.Pow(10, (oppElo-prev)/eloConstD))
		}

		var expect float64
		if playersCount == 1 {
			expect = 1
		} else {
			expect = (sum - 0.5) / (playersCount * (playersCount - 1) / 2)
		}

		delta := eloConstK * (norm - expect)
		newElo[pid] = prev + delta
	}
	return newElo
}
