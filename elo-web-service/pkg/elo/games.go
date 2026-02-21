package elo

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strconv"

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
	DeleteGame(ctx context.Context, id int32) (*db.Game, error)
	UpdateGameName(ctx context.Context, id int32, name string) (*db.Game, error)
	AddGame(ctx context.Context, name string) (*db.Game, error)
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
	// retrieve settings (Elo constants) from google-sheet (keeps existing behavior for settings)
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve settings: %v", err)
	}

	gid, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("invalid game id: %v", err)
	}

	// fetch matches and player scores for the given game in a single query
	rows, err := s.Queries.ListMatchesWithPlayersByGame(ctx, int32(gid))
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve matches from db: %v", err)
	}

	playersElo := map[string]float64{}
	totalMatches := 0

	var currentMatchID int32 = -1
	playersScore := make(map[string]float64)

	for _, r := range rows {
		if r.MatchID != currentMatchID {
			if currentMatchID != -1 {
				playersElo = CalculateNewElo(playersElo, StartingElo, playersScore,
					parsedData.Settings.EloConstK, parsedData.Settings.EloConstD)
			}
			// start new match
			currentMatchID = r.MatchID
			totalMatches++
			playersScore = make(map[string]float64)
		}

		pid := fmt.Sprintf("%d", r.PlayerID)
		playersScore[pid] = r.Score
	}

	// apply last match
	if len(playersScore) > 0 {
		playersElo = CalculateNewElo(playersElo, StartingElo, playersScore,
			parsedData.Settings.EloConstK, parsedData.Settings.EloConstD)
	}

	players := make([]struct {
		Id   string
		Elo  float64
		Rank int
	}, 0, len(playersElo))

	for pid, elo := range playersElo {
		players = append(players, struct {
			Id   string
			Elo  float64
			Rank int
		}{
			Id:   pid,
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

	gameName := id
	if len(rows) > 0 {
		gameName = rows[0].GameName
	}

	return &GameStatistics{
		Id:           id,
		Name:         gameName,
		TotalMatches: totalMatches,
		Players:      players,
	}, nil
}

func (s *GameService) DeleteGame(ctx context.Context, id int32) (*db.Game, error) {
	g, err := s.Queries.DeleteGame(ctx, id)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (s *GameService) UpdateGameName(ctx context.Context, id int32, name string) (*db.Game, error) {
	g, err := s.Queries.UpdateGameName(ctx, db.UpdateGameNameParams{
		ID:   id,
		Name: name,
	})
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (s *GameService) AddGame(ctx context.Context, name string) (*db.Game, error) {
	g, err := s.Queries.AddGame(ctx, name)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func reduce[T, M any](s []T, f func(M, *T) M, initValue M) M {
	acc := initValue
	for _, v := range s {
		acc = f(acc, &v)
	}
	return acc
}
