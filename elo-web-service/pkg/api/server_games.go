package api

import (
	"context"
	"net/http"
)

func (s *StrictServer) ListGames(ctx context.Context, _ ListGamesRequestObject) (ListGamesResponseObject, error) {
	games, err := s.api.GameService.GetGameTitlesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, err
	}

	gameList := make([]GameListItem, 0, len(games))
	for i, g := range games {
		tags := make([]GameTag, 0, len(g.Tags))
		for _, t := range g.Tags {
			tags = append(tags, GameTag{Id: t.Id, Name: t.Name})
		}
		gameList = append(gameList, GameListItem{
			Id:              g.Id,
			Name:            g.Name,
			LastPlayedOrder: i,
			TotalMatches:    g.TotalMatches,
			Tags:            tags,
		})
	}

	return ListGames200JSONResponse{Status: "success", Data: GameList{Games: gameList}}, nil
}

func (s *StrictServer) GetGame(ctx context.Context, request GetGameRequestObject) (GetGameResponseObject, error) {
	gameID := parseIDParam(request.Id)
	game, err := s.api.GameService.GetGameInfo(ctx, gameID)
	if err != nil {
		if gameNotFound(err) {
			return GetGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
		}
		return GetGame400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	return GetGame200JSONResponse{
		Status: "success",
		Data: Game{
			Id:           game.ID,
			Name:         game.Name,
			TotalMatches: game.TotalMatches,
		},
	}, nil
}

func (s *StrictServer) CreateGame(ctx context.Context, request CreateGameRequestObject) (CreateGameResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateGame400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	game, err := s.api.GameService.AddGame(ctx, request.Body.Id, name, currentActorID(ctx))
	if err != nil {
		if domainStatusCode(err) == http.StatusConflict {
			return CreateGame409JSONResponse{Status: "fail", Message: "game with this name already exists"}, nil
		}
		return nil, err
	}

	resp := CreateGame200JSONResponse{Status: "success"}
	resp.Data.Id = game.ID
	resp.Data.Name = game.Name
	return resp, nil
}

func (s *StrictServer) PatchGame(ctx context.Context, request PatchGameRequestObject) (PatchGameResponseObject, error) {
	game, err := s.api.GameService.UpdateGameName(ctx, parseIDParam(request.Id), request.Body.Name, currentActorID(ctx))
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return PatchGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
		}
		return nil, err
	}

	resp := PatchGame200JSONResponse{Status: "success"}
	resp.Data.Id = game.ID
	resp.Data.Name = game.Name
	return resp, nil
}

func (s *StrictServer) DeleteGame(ctx context.Context, request DeleteGameRequestObject) (DeleteGameResponseObject, error) {
	_, err := s.api.GameService.DeleteGame(ctx, parseIDParam(request.Id), currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return DeleteGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
	case domainStatusCode(err) == http.StatusBadRequest:
		return DeleteGame400JSONResponse{Status: "fail", Message: "cannot delete game with matches"}, nil
	default:
		return nil, err
	}

	return DeleteGame200JSONResponse{Status: "success", Message: "Game deleted"}, nil
}

// gameNotFound reports whether err is the games table's no-rows error.
func gameNotFound(err error) bool {
	return err != nil && domainStatusCode(err) == http.StatusNotFound
}
