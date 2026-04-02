package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	GeologistName *string         `json:"geologist_name,omitempty"`
	Rank          historyRankJson `json:"rank"`
	UserID        *string         `json:"user_id"`
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

	userLinks, err := a.PlayerService.ListPlayerUserLinks(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	playerUserMap := make(map[int32]string, len(userLinks))
	for _, link := range userLinks {
		if link.PlayerID.Valid {
			playerUserMap[link.PlayerID.Int32] = fmt.Sprintf("%d", link.UserID)
		}
	}

	dbPlayers, err := a.PlayerService.ListPlayers(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	geologistNameMap := make(map[int32]string, len(dbPlayers))
	for _, dp := range dbPlayers {
		if dp.GeologistName.Valid {
			geologistNameMap[dp.ID] = dp.GeologistName.String
		}
	}

	jsonPlayers := make([]playerJson, 0, len(actualPlayers))
	for _, p := range actualPlayers {
		dayAgo := findPlayer(dayAgoPlayers, p.ID)
		weekAgo := findPlayer(weekAgoPlayers, p.ID)

		var userID *string
		var geologistName *string
		if idInt, err := strconv.Atoi(p.ID); err == nil {
			if uid, ok := playerUserMap[int32(idInt)]; ok {
				userID = &uid
			}
			if gn, ok := geologistNameMap[int32(idInt)]; ok {
				geologistName = &gn
			}
		}

		jsonPlayers = append(jsonPlayers, playerJson{
			ID:            p.ID,
			Name:          p.Name,
			GeologistName: geologistName,
			UserID:        userID,
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

type ratingPointJson struct {
	Date   string  `json:"date"`
	Rating float64 `json:"rating"`
}

type gameMatchStatJson struct {
	GameID       string `json:"game_id"`
	GameName     string `json:"game_name"`
	MatchesCount int32  `json:"matches_count"`
	Wins         int32  `json:"wins"`
}

type gameEloStatJson struct {
	GameID   string  `json:"game_id"`
	GameName string  `json:"game_name"`
	EloEarned float64 `json:"elo_earned"`
}

type playerStatsJson struct {
	PlayerName           string              `json:"player_name"`
	RatingHistory        []ratingPointJson   `json:"rating_history"`
	TopGamesByMatches    []gameMatchStatJson  `json:"top_games_by_matches"`
	TopGamesByEloEarned  []gameEloStatJson    `json:"top_games_by_elo_earned"`
	WorstGamesByEloEarned []gameEloStatJson   `json:"worst_games_by_elo_earned"`
}

func (a *API) GetPlayerStats(c *gin.Context) {
	ctx := c.Request.Context()

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid player id: %w", err))
		return
	}
	playerID := int32(idInt)

	player, err := a.PlayerService.GetPlayer(ctx, playerID)
	if err != nil {
		if db.IsNoRows(err) {
			ErrorResponse(c, http.StatusNotFound, fmt.Errorf("player not found"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	ratingRows, err := a.PlayerService.RatingHistory(ctx, playerID)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	ratingHistory := make([]ratingPointJson, 0, len(ratingRows))
	for _, r := range ratingRows {
		if r.Date.Valid {
			ratingHistory = append(ratingHistory, ratingPointJson{
				Date:   r.Date.Time.UTC().Format(time.RFC3339),
				Rating: r.Rating,
			})
		}
	}

	gameStats, err := a.PlayerService.GetPlayerGameStats(ctx, playerID)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	topGamesByMatches := make([]gameMatchStatJson, 0, len(gameStats))
	for _, g := range gameStats {
		topGamesByMatches = append(topGamesByMatches, gameMatchStatJson{
			GameID:       g.GameID,
			GameName:     g.GameName,
			MatchesCount: g.MatchesCount,
			Wins:         g.Wins,
		})
	}

	eloStats, err := a.PlayerService.GetPlayerGameEloStats(ctx, playerID)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	topGamesByElo := make([]gameEloStatJson, 0)
	worstGamesByElo := make([]gameEloStatJson, 0)

	limit := 10
	for i, g := range eloStats {
		if i < limit {
			topGamesByElo = append(topGamesByElo, gameEloStatJson{
				GameID:   g.GameID,
				GameName: g.GameName,
				EloEarned: g.EloEarned,
			})
		}
	}
	// worst = last up to 10, in ascending order
	start := len(eloStats) - limit
	if start < 0 {
		start = 0
	}
	for i := len(eloStats) - 1; i >= start; i-- {
		g := eloStats[i]
		worstGamesByElo = append(worstGamesByElo, gameEloStatJson{
			GameID:   g.GameID,
			GameName: g.GameName,
			EloEarned: g.EloEarned,
		})
	}

	SuccessDataResponse(c, playerStatsJson{
		PlayerName:            player.Name,
		RatingHistory:         ratingHistory,
		TopGamesByMatches:     topGamesByMatches,
		TopGamesByEloEarned:   topGamesByElo,
		WorstGamesByEloEarned: worstGamesByElo,
	})
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

	player, err := a.PlayerService.CreatePlayer(c.Request.Context(), body.Name)
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

	player, err := a.PlayerService.UpdatePlayer(c.Request.Context(), int32(idInt), body.Name)
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
	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid player id: %w", err))
		return
	}

	err = a.PlayerService.DeletePlayer(c.Request.Context(), int32(idInt))
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
