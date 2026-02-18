package elo

import (
	"fmt"
	"math"
	"slices"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type GameStatistics struct {
	Id           string
	TotalMatches int
	Players      []struct {
		Id   string
		Elo  float64
		Rank int
	}
}

type GameTitles struct {
	Id           string
	Name         string
	TotalMatches int
}

func GetGameTitlesOrderedByLastPlayed() ([]GameTitles, error) {

	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	seen := make(map[string]bool)
	var gameList []GameTitles
	for i := len(parsedData.Matches) - 1; i >= 0; i-- {
		row := parsedData.Matches[i]
		if len(row.PlayersScore) == 0 {
			continue
		}
		name := row.Game
		if name == "" {
			continue
		}
		if !seen[name] {
			seen[name] = true

			totalMatches := reduce(parsedData.Matches, func(acc int, row *googlesheet.MatchRow) int {
				if row.Game == name {
					return acc + 1
				}
				return acc
			}, 0)

			gameList = append(gameList, GameTitles{
				Id:           name,
				Name:         name,
				TotalMatches: totalMatches,
			})
		}
	}

	return gameList, nil
}

func GetGameStatistics(id string) (*GameStatistics, error) {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	var totalMatches int = 0
	playersElo := map[string]float64{}

	for _, match := range parsedData.Matches {
		if match.Game == id {
			totalMatches++
		} else {
			continue
		}

		playersElo = CalculateNewElo(playersElo, StartingElo,
			match.PlayersScore, parsedData.Settings.EloConstK, parsedData.Settings.EloConstD)
	}

	players := make([]struct {
		Id   string
		Elo  float64
		Rank int
	}, 0, len(playersElo))

	for id, elo := range playersElo {
		players = append(players, struct {
			Id   string
			Elo  float64
			Rank int
		}{
			Id:   id,
			Elo:  elo,
			Rank: 0,
		})
	}

	slices.SortFunc(players, func(a, b struct {
		Id   string
		Elo  float64
		Rank int
	}) int {
		if b.Elo-a.Elo > 0 {
			return 1
		}
		if b.Elo-a.Elo < 0 {
			return -1
		}
		return 0
	})

	for i := range players {
		if i > 0 && math.Round(players[i].Elo) == math.Round(players[i-1].Elo) {
			players[i].Rank = players[i-1].Rank
		} else {
			players[i].Rank = i + 1
		}
	}

	return &GameStatistics{
		Id:           id,
		TotalMatches: totalMatches,
		Players:      players,
	}, nil
}

func reduce[T, M any](s []T, f func(M, *T) M, initValue M) M {
	acc := initValue
	for _, v := range s {
		acc = f(acc, &v)
	}
	return acc
}
