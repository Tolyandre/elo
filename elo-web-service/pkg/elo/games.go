package elo

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type GamePlayerStat struct {
	Id                        string
	Elo                       float64
	League                    string
	Rank                      int
	WinsNeededForAmateurLower int
	WinsNeededForAmateurUpper int
}

type GameStatistics struct {
	Id           string
	Name         string
	TotalMatches int
	Players      []GamePlayerStat
}

type GameTitles struct {
	Id           string
	Name         string
	TotalMatches int
}

type GameMatchPlayer struct {
	Id           string
	Name         string
	Score        float64
	RatingStaked float64
	RatingEarned float64
	RatingAfter  float64
}

type GameMatch struct {
	Id      int32
	Date    interface{} // pgtype.Timestamptz
	Players []GameMatchPlayer
}

type IGameService interface {
	GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error)
	GetGameStatistics(ctx context.Context, id string) (*GameStatistics, error)
	GetGameMatches(ctx context.Context, id string) ([]GameMatch, error)
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
	gid, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("invalid game id: %v", err)
	}

	// Read latest game rating per player from DB (display rating + league)
	ratingRows, err := s.Queries.ListLatestGameRatingPerPlayer(ctx, int32(gid))
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve game rating from db: %v", err)
	}

	// Get total match count for the game
	totalMatches, err := s.Queries.GetCountMatchesByGame(ctx, int32(gid))
	if err != nil {
		return nil, fmt.Errorf("unable to get match count: %v", err)
	}

	// Get game name from the games list (reuse existing query)
	gameRows, err := s.Queries.ListGamesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to get game name: %v", err)
	}
	gameName := id
	for _, g := range gameRows {
		if int32(g.ID) == int32(gid) {
			gameName = g.Name
			break
		}
	}

	settingsRow, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		return nil, fmt.Errorf("unable to get elo settings: %v", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	players := make([]GamePlayerStat, 0, len(ratingRows))
	for _, r := range ratingRows {
		var winsLower, winsUpper int
		if r.League == "newbie" {
			gap := r.GameEloAfter - r.GameRatingAfter
			winsLower, winsUpper = calcWinsNeededForAmateur(gap, settings)
		}

		players = append(players, GamePlayerStat{
			Id:                        fmt.Sprintf("%d", r.PlayerID),
			Elo:                       r.GameRatingAfter,
			League:                    r.League,
			WinsNeededForAmateurLower: winsLower,
			WinsNeededForAmateurUpper: winsUpper,
		})
	}

	// Sort: amateur first, then newbie; within each league by rating descending.
	slices.SortFunc(players, func(a, b GamePlayerStat) int {
		pa, pb := leaguePriority(a.League), leaguePriority(b.League)
		if pa != pb {
			return pa - pb
		}
		if b.Elo-a.Elo > 0 {
			return 1
		}
		if b.Elo-a.Elo < 0 {
			return -1
		}
		return 0
	})

	// Assign continuous ranks; ties share rank only within the same league.
	rank := 0
	var prevRoundElo float64 = math.NaN()
	var prevRank int
	var prevLeague string
	for i := range players {
		rounded := math.Round(players[i].Elo)
		if !math.IsNaN(prevRoundElo) && rounded == prevRoundElo && players[i].League == prevLeague {
			players[i].Rank = prevRank
		} else {
			players[i].Rank = rank + 1
			prevRank = players[i].Rank
			prevRoundElo = rounded
			prevLeague = players[i].League
		}
		rank++
	}

	return &GameStatistics{
		Id:           id,
		Name:         gameName,
		TotalMatches: int(totalMatches),
		Players:      players,
	}, nil
}

func (s *GameService) GetGameMatches(ctx context.Context, id string) ([]GameMatch, error) {
	gid, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("invalid game id: %v", err)
	}

	rows, err := s.Queries.ListMatchesWithPlayersByGameFromDB(ctx, int32(gid))
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve game matches from db: %v", err)
	}

	// Group rows by match (already ordered ASC by date/id)
	matchMap := make(map[int32]*GameMatch)
	order := make([]int32, 0)

	for _, r := range rows {
		if _, ok := matchMap[r.MatchID]; !ok {
			m := &GameMatch{
				Id:      r.MatchID,
				Date:    r.Date,
				Players: make([]GameMatchPlayer, 0),
			}
			matchMap[r.MatchID] = m
			order = append(order, r.MatchID)
		}

		matchMap[r.MatchID].Players = append(matchMap[r.MatchID].Players, GameMatchPlayer{
			Id:           fmt.Sprintf("%d", r.PlayerID),
			Name:         r.PlayerName,
			Score:        r.Score,
			RatingStaked: r.GameRatingStaked.Float64,
			RatingEarned: r.GameRatingEarned.Float64,
			RatingAfter:  r.GameRatingAfter.Float64,
		})
	}

	result := make([]GameMatch, 0, len(order))
	for _, mid := range order {
		result = append(result, *matchMap[mid])
	}

	return result, nil
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
