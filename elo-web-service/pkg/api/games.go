package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (a *API) ListGames(c *gin.Context) {
	type gameJson struct {
		Id              string `json:"id"`
		Name            string `json:"name"`
		LastPlayedOrder int    `json:"last_played_order"`
		TotalMatches    int    `json:"total_matches"`
	}

	type gamesJson struct {
		Games []gameJson `json:"games"`
	}

	games, err := a.GameService.GetGameTitlesOrderedByLastPlayed(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	var gameList = make([]gameJson, 0)
	for i, g := range games {
		gameList = append(gameList, gameJson{
			Id:              g.Id,
			Name:            g.Name,
			LastPlayedOrder: i,
			TotalMatches:    g.TotalMatches,
		})
	}

	SuccessDataResponse(c, gamesJson{
		Games: gameList,
	})
}

func (a *API) GetGame(c *gin.Context) {
	type playerJson struct {
		Id   string  `json:"id"`
		Elo  float64 `json:"elo"`
		Rank int     `json:"rank"`
	}

	type gameJson struct {
		Id           string       `json:"id"`
		Name         string       `json:"name"`
		TotalMatches int          `json:"total_matches"`
		Players      []playerJson `json:"players"`
	}

	id := c.Param("id")
	gameStatistics, err := a.GameService.GetGameStatistics(c, id)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	var playerList []playerJson = make([]playerJson, 0, len(gameStatistics.Players))
	for _, p := range gameStatistics.Players {
		playerList = append(playerList, playerJson{
			Id:   p.Id,
			Elo:  p.Elo,
			Rank: p.Rank,
		})
	}

	SuccessDataResponse(c, gameJson{
		Id:           id,
		Name:         gameStatistics.Name,
		TotalMatches: gameStatistics.TotalMatches,
		Players:      playerList,
	})
}

func (a *API) PatchGame(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit games"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid game id: %w", err))
		return
	}

	var body struct {
		Name string `json:"name"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	game, err := a.GameService.UpdateGameName(c.Request.Context(), int32(idInt), body.Name)
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("game not found: %w", err))
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	}{
		Id:   strconv.Itoa(int(game.ID)),
		Name: game.Name,
	}

	SuccessDataResponse(c, resp)
}

func (a *API) CreateGame(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit games"))
		return
	}

	var body struct {
		Name string `json:"name"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if body.Name == "" {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}

	game, err := a.GameService.AddGame(c.Request.Context(), body.Name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			ErrorResponse(c, http.StatusConflict, fmt.Errorf("game with this name already exists"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	}{
		Id:   strconv.Itoa(int(game.ID)),
		Name: game.Name,
	}

	SuccessDataResponse(c, resp)
}

func (a *API) GetGameMatches(c *gin.Context) {
	type gameMatchPlayerJson struct {
		Id          string  `json:"id"`
		Name        string  `json:"name"`
		Score       float64 `json:"score"`
		GameEloPay  float64 `json:"game_elo_pay"`
		GameEloEarn float64 `json:"game_elo_earn"`
		GameNewElo  float64 `json:"game_new_elo"`
	}

	type gameMatchJson struct {
		Id      int32                 `json:"id"`
		Date    *time.Time            `json:"date"`
		Players []gameMatchPlayerJson `json:"players"`
	}

	id := c.Param("id")
	matches, err := a.GameService.GetGameMatches(c.Request.Context(), id)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	result := make([]gameMatchJson, 0, len(matches))
	for _, m := range matches {
		players := make([]gameMatchPlayerJson, 0, len(m.Players))
		for _, p := range m.Players {
			players = append(players, gameMatchPlayerJson{
				Id:          p.Id,
				Name:        p.Name,
				Score:       p.Score,
				GameEloPay:  p.GameEloPay,
				GameEloEarn: p.GameEloEarn,
				GameNewElo:  p.GameNewElo,
			})
		}
		var datePtr *time.Time
		if ts, ok := m.Date.(pgtype.Timestamptz); ok && ts.Valid {
			t := ts.Time
			datePtr = &t
		}
		result = append(result, gameMatchJson{
			Id:      m.Id,
			Date:    datePtr,
			Players: players,
		})
	}

	SuccessDataResponse(c, result)
}

func (a *API) RecalculateGameElo(c *gin.Context) {
	if err := a.MatchService.RecalculateAllGameElo(c.Request.Context()); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Game Elo recalculated successfully")
}

func (a *API) DeleteGame(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit games"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid game id: %w", err))
		return
	}

	_, err = a.GameService.DeleteGame(c.Request.Context(), int32(idInt))
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("game not found: %w", err))
		return
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("cannot delete game with matches"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Game deleted")
}
