package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
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
			Alias:           strPtrOrNil(g.Alias),
			NameOriginal:    strPtrOrNil(g.NameOriginal),
			NameRu:          strPtrOrNil(g.NameRu),
			BggRef:          intPtrOrNil(g.BggRef),
			TeseraRef:       intPtrOrNil(g.TeseraRef),
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
			Alias:        strPtrOrNil(game.Alias),
			NameOriginal: strPtrOrNil(game.NameOriginal),
			NameRu:       strPtrOrNil(game.NameRu),
			BggRef:       intPtrOrNil(game.BggRef),
			TeseraRef:    intPtrOrNil(game.TeseraRef),
			TotalMatches: game.TotalMatches,
		},
	}, nil
}

func (s *StrictServer) CreateGame(ctx context.Context, request CreateGameRequestObject) (CreateGameResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateGame400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	var meta []elo.GameMetaPatch
	if m, ok := createMeta(request.Body); ok {
		meta = append(meta, m)
	}
	game, err := s.api.GameService.AddGame(ctx, request.Body.Id, name, currentActorID(ctx), meta...)
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

// createMeta carries the accepted catalogue suggestion (canonical names and
// external refs) into AddGame; the alias is derived there, not sent.
func createMeta(body *CreateGameJSONRequestBody) (elo.GameMetaPatch, bool) {
	if body == nil || (body.NameOriginal == nil && body.NameRu == nil && body.BggRef == nil && body.TeseraRef == nil) {
		return elo.GameMetaPatch{}, false
	}
	return elo.GameMetaPatch{
		NameOriginal: body.NameOriginal,
		NameRu:       body.NameRu,
		BggRef:       int64PtrOf(body.BggRef),
		TeseraRef:    int64PtrOf(body.TeseraRef),
	}, true
}

func (s *StrictServer) PatchGame(ctx context.Context, request PatchGameRequestObject) (PatchGameResponseObject, error) {
	body := request.Body
	meta := elo.GameMetaPatch{
		Alias:        body.Alias,
		NameOriginal: body.NameOriginal,
		NameRu:       body.NameRu,
		BggRef:       int64PtrOf(body.BggRef),
		TeseraRef:    int64PtrOf(body.TeseraRef),
	}
	game, err := s.api.GameService.UpdateGame(ctx, parseIDParam(request.Id), meta, currentActorID(ctx))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusNotFound:
			return PatchGame404JSONResponse{Status: "fail", Message: "game not found"}, nil
		case http.StatusBadRequest:
			return PatchGame400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case http.StatusConflict:
			return PatchGame409JSONResponse{Status: "fail", Message: "game with this display name already exists"}, nil
		}
		return nil, err
	}

	resp := PatchGame200JSONResponse{Status: "success"}
	resp.Data.Id = game.ID
	resp.Data.Name = game.Name
	resp.Data.Alias = strPtrOrNil(pgTextOf(game.Alias))
	resp.Data.NameOriginal = strPtrOrNil(pgTextOf(game.NameOriginal))
	resp.Data.NameRu = strPtrOrNil(pgTextOf(game.NameRu))
	resp.Data.BggRef = intPtrOrNil(pgInt64Of(game.BggID))
	resp.Data.TeseraRef = intPtrOrNil(pgInt64Of(game.TeseraID))
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

func (s *StrictServer) SuggestGames(ctx context.Context, request SuggestGamesRequestObject) (SuggestGamesResponseObject, error) {
	query := strings.TrimSpace(request.Params.Query)
	if query == "" {
		return SuggestGames400JSONResponse{Status: "fail", Message: "query is required"}, nil
	}
	suggestions, err := s.api.GameService.SuggestGames(ctx, query)
	if err != nil {
		return nil, err
	}

	items := make([]GameSuggestion, 0, len(suggestions))
	for _, sug := range suggestions {
		item := GameSuggestion{
			TeseraRef:    int(sug.TeseraRef),
			BggRef:       intPtrOrNil(sug.BggRef),
			NameOriginal: strPtrOrNil(sug.NameOriginal),
			NameRu:       strPtrOrNil(sug.NameRu),
			Title:        sug.Title,
			Year:         intPtrOrNil(int64(sug.Year)),
			PhotoUrl:     strPtrOrNil(sug.PhotoURL),
			IsAddition:   sug.IsAddition,
		}
		items = append(items, item)
	}
	return SuggestGames200JSONResponse{Status: "success", Data: GameSuggestionList{Games: items}}, nil
}

func (s *StrictServer) AutoMatchGames(ctx context.Context, _ AutoMatchGamesRequestObject) (AutoMatchGamesResponseObject, error) {
	results, err := s.api.GameService.AutoMatchGames(ctx, currentActorID(ctx))
	if err != nil {
		return nil, err
	}

	items := make([]GameAutoMatchResult, 0, len(results))
	for _, r := range results {
		items = append(items, GameAutoMatchResult{
			Id:      r.GameID,
			Name:    r.Name,
			Matched: r.Matched,
			Reason:  strPtrOrNil(r.Reason),
		})
	}
	return AutoMatchGames200JSONResponse{Status: "success", Data: GameAutoMatchResults{Games: items}}, nil
}

// gameNotFound reports whether err is the games table's no-rows error.
func gameNotFound(err error) bool {
	return err != nil && domainStatusCode(err) == http.StatusNotFound
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func intPtrOrNil(v int64) *int {
	if v == 0 {
		return nil
	}
	i := int(v)
	return &i
}

func int64PtrOf(v *int) *int64 {
	if v == nil || *v == 0 {
		return nil
	}
	i := int64(*v)
	return &i
}

func pgTextOf(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func pgInt64Of(i pgtype.Int4) int64 {
	if !i.Valid {
		return 0
	}
	return int64(i.Int32)
}
