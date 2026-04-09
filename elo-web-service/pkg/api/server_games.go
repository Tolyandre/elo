package api

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (s *StrictServer) RecalculateGameElo(ctx context.Context, _ RecalculateGameEloRequestObject) (RecalculateGameEloResponseObject, error) {
	if err := s.api.MatchService.RecalculateAllGameElo(ctx); err != nil {
		return nil, err
	}
	return RecalculateGameElo200JSONResponse{Status: "success", Message: "Game Elo recalculated successfully"}, nil
}

func (s *StrictServer) ListGames(ctx context.Context, _ ListGamesRequestObject) (ListGamesResponseObject, error) {
	games, err := s.api.GameService.GetGameTitlesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, err
	}

	gameList := make([]GameListItem, 0, len(games))
	for i, g := range games {
		gameList = append(gameList, GameListItem{
			Id:              g.Id,
			Name:            g.Name,
			LastPlayedOrder: i,
			TotalMatches:    g.TotalMatches,
		})
	}

	return ListGames200JSONResponse{Status: "success", Data: GameList{Games: gameList}}, nil
}

func (s *StrictServer) GetGame(ctx context.Context, request GetGameRequestObject) (GetGameResponseObject, error) {
	gameStatistics, err := s.api.GameService.GetGameStatistics(ctx, request.Id)
	if err != nil {
		return GetGame400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	players := make([]GamePlayer, 0, len(gameStatistics.Players))
	for _, p := range gameStatistics.Players {
		players = append(players, GamePlayer{
			Id:   p.Id,
			Elo:  p.Elo,
			Rank: p.Rank,
		})
	}

	return GetGame200JSONResponse{
		Status: "success",
		Data: Game{
			Id:           request.Id,
			Name:         gameStatistics.Name,
			TotalMatches: gameStatistics.TotalMatches,
			Players:      players,
		},
	}, nil
}

func (s *StrictServer) CreateGame(ctx context.Context, request CreateGameRequestObject) (CreateGameResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateGame400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	game, err := s.api.GameService.AddGame(ctx, name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreateGame409JSONResponse{Status: "fail", Message: "game with this name already exists"}, nil
		}
		return nil, err
	}

	resp := CreateGame200JSONResponse{Status: "success"}
	resp.Data.Id = strconv.Itoa(int(game.ID))
	resp.Data.Name = game.Name
	return resp, nil
}

func (s *StrictServer) PatchGame(ctx context.Context, request PatchGameRequestObject) (PatchGameResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return PatchGame400JSONResponse{Status: "fail", Message: fmt.Sprintf("invalid game id: %v", err)}, nil
	}

	game, err := s.api.GameService.UpdateGameName(ctx, int32(idInt), request.Body.Name)
	if db.IsNoRows(err) {
		return PatchGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
	}
	if err != nil {
		return nil, err
	}

	resp := PatchGame200JSONResponse{Status: "success"}
	resp.Data.Id = strconv.Itoa(int(game.ID))
	resp.Data.Name = game.Name
	return resp, nil
}

func (s *StrictServer) DeleteGame(ctx context.Context, request DeleteGameRequestObject) (DeleteGameResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return DeleteGame400JSONResponse{Status: "fail", Message: fmt.Sprintf("invalid game id: %v", err)}, nil
	}

	_, err = s.api.GameService.DeleteGame(ctx, int32(idInt))
	if db.IsNoRows(err) {
		return DeleteGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			return DeleteGame400JSONResponse{Status: "fail", Message: "cannot delete game with matches"}, nil
		}
		return nil, err
	}

	return DeleteGame200JSONResponse{Status: "success", Message: "Game deleted"}, nil
}

func (s *StrictServer) GetGameMatches(ctx context.Context, request GetGameMatchesRequestObject) (GetGameMatchesResponseObject, error) {
	matches, err := s.api.GameService.GetGameMatches(ctx, request.Id)
	if err != nil {
		return GetGameMatches400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	result := make([]GameMatch, 0, len(matches))
	for _, m := range matches {
		players := make([]GameMatchPlayer, 0, len(m.Players))
		for _, p := range m.Players {
			players = append(players, GameMatchPlayer{
				Id:          p.Id,
				Name:        p.Name,
				Score:       p.Score,
				GameEloPay:  p.GameEloPay,
				GameEloEarn: p.GameEloEarn,
				GameNewElo:  p.GameNewElo,
			})
		}
		gm := GameMatch{
			Id:      int(m.Id),
			Players: players,
		}
		if ts, ok := m.Date.(pgtype.Timestamptz); ok && ts.Valid {
			t := ts.Time
			gm.Date = &t
		} else if t, ok := m.Date.(time.Time); ok {
			gm.Date = &t
		}
		result = append(result, gm)
	}

	return GetGameMatches200JSONResponse{Status: "success", Data: result}, nil
}
