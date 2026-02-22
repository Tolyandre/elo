package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Rank historyRankJson `json:"rank"`
}

type historyRankJson struct {
	Now     playerEloRankJson `json:"now"`
	DayAgo  playerEloRankJson `json:"day_ago"`
	WeekAgo playerEloRankJson `json:"week_ago"`
}
type playerEloRankJson struct {
	Elo                  float64 `json:"elo"`
	Rank                 *int    `json:"rank"`
	MatchesLeftForRanked int     `json:"matches_left_for_ranked"`
}

func (a *API) ListPlayers(c *gin.Context) {
	ctx := c.Request.Context()

	actualPlayers, err := a.PlayerService.GetPlayersWithRank(ctx, nil)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	tDay := time.Now().Add(-time.Hour * 12)
	dayAgoPlayers, err := a.PlayerService.GetPlayersWithRank(ctx, &tDay)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	tWeek := time.Now().Add(-time.Hour * (24*7 - 12))
	weekAgoPlayers, err := a.PlayerService.GetPlayersWithRank(ctx, &tWeek)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	jsonPlayers := make([]playerJson, 0, len(actualPlayers))
	for _, p := range actualPlayers {
		dayAgo := findPlayer(dayAgoPlayers, p.ID)
		weekAgo := findPlayer(weekAgoPlayers, p.ID)
		jsonPlayers = append(jsonPlayers, playerJson{
			ID:   p.ID,
			Name: p.Name,
			Rank: historyRankJson{
				Now: playerEloRankJson{
					Elo:                  p.Elo,
					Rank:                 p.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				DayAgo: playerEloRankJson{
					Elo:                  dayAgo.Elo,
					Rank:                 dayAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				WeekAgo: playerEloRankJson{
					Elo:                  weekAgo.Elo,
					Rank:                 weekAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
			},
		})
	}

	SuccessDataResponse(c, jsonPlayers)
}

func findPlayer(players []elo.Player, id string) *elo.Player {
	for _, player := range players {
		if player.ID == id {
			return &player
		}
	}
	return nil
}

func (a *API) CreatePlayer(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to create players"))
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

	player, err := a.Queries.CreatePlayer(c.Request.Context(), db.CreatePlayerParams{
		Name:              body.Name,
		GeologistName:     pgtype.Text{Valid: false},
		GoogleSheetColumn: pgtype.Int4{Valid: false},
	})
	if err != nil {
		if db.IsUniqueViolation(err) {
			ErrorResponse(c, http.StatusConflict, fmt.Errorf("player with this name already exists"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	}{
		Id:   strconv.Itoa(int(player.ID)),
		Name: player.Name,
	}

	SuccessDataResponse(c, resp)
}

func (a *API) PatchPlayer(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit players"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid player id: %w", err))
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

	player, err := a.Queries.UpdatePlayer(c.Request.Context(), db.UpdatePlayerParams{
		ID:   int32(idInt),
		Name: body.Name,
	})
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("player not found: %w", err))
		return
	}
	if err != nil {
		if db.IsUniqueViolation(err) {
			ErrorResponse(c, http.StatusConflict, fmt.Errorf("player with this name already exists"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := struct {
		Id   string `json:"id"`
		Name string `json:"name"`
	}{
		Id:   strconv.Itoa(int(player.ID)),
		Name: player.Name,
	}

	SuccessDataResponse(c, resp)
}

func (a *API) DeletePlayer(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to delete players"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid player id: %w", err))
		return
	}

	err = a.Queries.DeletePlayer(c.Request.Context(), int32(idInt))
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("player not found: %w", err))
		return
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("cannot delete player with matches"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Player deleted")
}
