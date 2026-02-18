package elo

import (
	"context"
	"fmt"
	"math"
	"slices"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type GameStatistics struct {
	Id           string
	Name         string
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

type IGameService interface {
	GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error)
	GetGameStatistics(ctx context.Context, id string) (*GameStatistics, error)
}

type GameService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewGameService(pool *pgxpool.Pool) IGameService {
	return &GameService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

func (s *GameService) GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error) {
	rows, err := s.Queries.ListGamesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve games from db: %v", err)
	}

	gameList := make([]GameTitles, 0, len(rows))
	for _, r := range rows {
		gameList = append(gameList, GameTitles{
			Id:           fmt.Sprintf("%d", r.ID),
			Name:         r.Name,
			TotalMatches: int(r.TotalMatches),
		})
	}

	return gameList, nil
}

func (s *GameService) GetGameStatistics(ctx context.Context, id string) (*GameStatistics, error) {
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
		Name:         id, // TODO: change to name
		TotalMatches: totalMatches,
		Players:      players,
	}, nil
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
