package api

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

// tryGetCurrentUserID returns the user ID from context if present, or 0, false.
func tryGetCurrentUserID(ctx *gin.Context) (int32, bool) {
	val, exists := ctx.Get(CurrentUserKey)
	if !exists {
		return 0, false
	}
	id, err := strconv.Atoi(val.(string))
	if err != nil {
		return 0, false
	}
	return int32(id), true
}

type settlementDetailJson struct {
	PlayerID   string  `json:"player_id"`
	PlayerName string  `json:"player_name"`
	Staked     float64 `json:"staked"`
	Earned     float64 `json:"earned"`
}

// marketPoolsJson represents the betting pools for a market.
type marketPoolsJson struct {
	ID             string                 `json:"id"`
	MarketType     string                 `json:"market_type"`
	Status         string                 `json:"status"`
	StartsAt       *time.Time             `json:"starts_at"`
	ClosesAt       *time.Time             `json:"closes_at"`
	CreatedAt      *time.Time             `json:"created_at"`
	ResolvedAt     *time.Time             `json:"resolved_at"`
	YesPool        float64                `json:"yes_pool"`
	NoPool         float64                `json:"no_pool"`
	YesCoeff       float64                `json:"yes_coefficient"`
	NoCoeff        float64                `json:"no_coefficient"`
	TargetPlayerID string                 `json:"target_player_id"`
	Params         interface{}            `json:"params"`
	Settlement     []settlementDetailJson `json:"settlement,omitempty"`
}

type marketDetailJson struct {
	marketPoolsJson
	// Per-player fields (populated when authenticated with player_id)
	MyYesStaked        *float64 `json:"my_yes_staked,omitempty"`
	MyNoStaked         *float64 `json:"my_no_staked,omitempty"`
	ProjectedYesReward *float64 `json:"projected_yes_reward,omitempty"`
	ProjectedNoReward  *float64 `json:"projected_no_reward,omitempty"`
	Reserved           *float64 `json:"reserved,omitempty"`
	BetLimit           *float64 `json:"bet_limit,omitempty"`
}

type matchWinnerParamsJson struct {
	RequiredPlayerIDs []string `json:"required_player_ids"`
	GameID            *string  `json:"game_id"`
}

type winStreakParamsJson struct {
	GameID       string `json:"game_id"`
	WinsRequired int32  `json:"wins_required"`
	MaxLosses    *int32 `json:"max_losses"`
}

func calcCoefficient(pool, totalPool float64) float64 {
	if pool == 0 {
		return 1
	}
	return totalPool / pool
}

// buildMarketParamsFromRow builds the target_player_id and params JSON from a row that includes LEFT JOIN params columns.
func buildMarketParamsFromRow(marketType string, targetPlayerID int32, requiredPlayerIds []int32, mwGameID pgtype.Int4, wsGameID pgtype.Int4, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, interface{}) {
	targetIDStr := fmt.Sprintf("%d", targetPlayerID)

	switch marketType {
	case "match_winner":
		reqIDs := make([]string, len(requiredPlayerIds))
		for i, rid := range requiredPlayerIds {
			reqIDs[i] = fmt.Sprintf("%d", rid)
		}
		var gameIDStr *string
		if mwGameID.Valid {
			s := fmt.Sprintf("%d", mwGameID.Int32)
			gameIDStr = &s
		}
		return targetIDStr, matchWinnerParamsJson{
			RequiredPlayerIDs: reqIDs,
			GameID:            gameIDStr,
		}
	case "win_streak":
		var maxL *int32
		if maxLosses.Valid {
			v := maxLosses.Int32
			maxL = &v
		}
		return targetIDStr, winStreakParamsJson{
			GameID:       fmt.Sprintf("%d", wsGameID.Int32),
			WinsRequired: winsRequired.Int32,
			MaxLosses:    maxL,
		}
	}
	return targetIDStr, nil
}

func (a *API) ListMarkets(c *gin.Context) {
	ctx := c.Request.Context()

	rows, err := a.Queries.ListMarketsWithPools(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	active := make([]marketPoolsJson, 0)
	closed := make([]marketPoolsJson, 0)

	for _, r := range rows {
		totalPool := r.YesPool + r.NoPool
		targetID, params := buildMarketParamsFromRow(r.MarketType, r.TargetPlayerID, r.RequiredPlayerIds, r.MwGameID, r.WsGameID, r.WinsRequired, r.MaxLosses)
		m := marketPoolsJson{
			ID:             fmt.Sprintf("%d", r.ID),
			MarketType:     r.MarketType,
			Status:         r.Status,
			YesPool:        r.YesPool,
			NoPool:         r.NoPool,
			YesCoeff:       calcCoefficient(r.YesPool, totalPool),
			NoCoeff:        calcCoefficient(r.NoPool, totalPool),
			TargetPlayerID: targetID,
			Params:         params,
		}
		if r.StartsAt.Valid {
			t := r.StartsAt.Time
			m.StartsAt = &t
		}
		if r.ClosesAt.Valid {
			t := r.ClosesAt.Time
			m.ClosesAt = &t
		}
		if r.CreatedAt.Valid {
			t := r.CreatedAt.Time
			m.CreatedAt = &t
		}
		if r.ResolvedAt.Valid {
			t := r.ResolvedAt.Time
			m.ResolvedAt = &t
		}

		if r.Status == "open" {
			active = append(active, m)
		} else {
			if r.Status == "resolved_yes" || r.Status == "resolved_no" {
				if details, err := a.Queries.GetSettlementDetails(ctx, r.ID); err == nil {
					m.Settlement = make([]settlementDetailJson, len(details))
					for i, d := range details {
						m.Settlement[i] = settlementDetailJson{
							PlayerID:   fmt.Sprintf("%d", d.PlayerID),
							PlayerName: d.PlayerName,
							Staked:     d.Staked,
							Earned:     d.Earned,
						}
					}
				}
			}
			closed = append(closed, m)
		}
	}

	sort.Slice(closed, func(i, j int) bool {
		ti := closed[i].ResolvedAt
		tj := closed[j].ResolvedAt
		if ti == nil && tj == nil {
			return false
		}
		if ti == nil {
			return false
		}
		if tj == nil {
			return true
		}
		return ti.After(*tj)
	})

	SuccessDataResponse(c, gin.H{
		"active": active,
		"closed": closed,
	})
}

func (a *API) GetMarket(c *gin.Context) {
	ctx := c.Request.Context()

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid market id")
		return
	}
	marketID := int32(id)

	row, err := a.Queries.GetMarketWithPools(ctx, marketID)
	if err != nil {
		ErrorResponse(c, http.StatusNotFound, "market not found")
		return
	}
	if row.Status == "open" && row.ClosesAt.Valid && row.ClosesAt.Time.Before(time.Now()) {
		_ = a.MarketService.ExpireOverdueMarkets(ctx)
		row, err = a.Queries.GetMarketWithPools(ctx, marketID)
		if err != nil {
			ErrorResponse(c, http.StatusInternalServerError, err)
			return
		}
	}

	totalPool := row.YesPool + row.NoPool
	targetID, params := buildMarketParamsFromRow(row.MarketType, row.TargetPlayerID, row.RequiredPlayerIds, row.MwGameID, row.WsGameID, row.WinsRequired, row.MaxLosses)
	detail := marketDetailJson{
		marketPoolsJson: marketPoolsJson{
			ID:             fmt.Sprintf("%d", row.ID),
			MarketType:     row.MarketType,
			Status:         row.Status,
			YesPool:        row.YesPool,
			NoPool:         row.NoPool,
			YesCoeff:       calcCoefficient(row.YesPool, totalPool),
			NoCoeff:        calcCoefficient(row.NoPool, totalPool),
			TargetPlayerID: targetID,
			Params:         params,
		},
	}
	if row.StartsAt.Valid {
		t := row.StartsAt.Time
		detail.StartsAt = &t
	}
	if row.ClosesAt.Valid {
		t := row.ClosesAt.Time
		detail.ClosesAt = &t
	}
	if row.CreatedAt.Valid {
		t := row.CreatedAt.Time
		detail.CreatedAt = &t
	}
	if row.ResolvedAt.Valid {
		t := row.ResolvedAt.Time
		detail.ResolvedAt = &t
	}

	if row.Status == "resolved_yes" || row.Status == "resolved_no" {
		if details, err := a.Queries.GetSettlementDetails(ctx, marketID); err == nil {
			detail.Settlement = make([]settlementDetailJson, len(details))
			for i, d := range details {
				detail.Settlement[i] = settlementDetailJson{
					PlayerID:   fmt.Sprintf("%d", d.PlayerID),
					PlayerName: d.PlayerName,
					Staked:     d.Staked,
					Earned:     d.Earned,
				}
			}
		}
	}

	userID, hasUser := tryGetCurrentUserID(c)
	if hasUser {
		user, err := a.UserService.GetUserByID(ctx, userID)
		if err == nil && user.PlayerID.Valid {
			playerID := user.PlayerID.Int32

			myBets, err := a.Queries.GetPlayerBetsAggregatedForMarket(ctx, db.GetPlayerBetsAggregatedForMarketParams{
				MarketID: marketID,
				PlayerID: playerID,
			})
			if err == nil {
				var myYes, myNo float64
				for _, b := range myBets {
					if b.Outcome == "yes" {
						myYes = b.TotalAmount
					} else {
						myNo = b.TotalAmount
					}
				}
				detail.MyYesStaked = &myYes
				detail.MyNoStaked = &myNo

				var projYes, projNo float64
				if row.YesPool > 0 {
					projYes = (myYes / row.YesPool) * totalPool
				}
				if row.NoPool > 0 {
					projNo = (myNo / row.NoPool) * totalPool
				}
				detail.ProjectedYesReward = &projYes
				detail.ProjectedNoReward = &projNo
			}

			reserved, err := a.Queries.GetPlayerReservedAmount(ctx, playerID)
			if err == nil {
				detail.Reserved = &reserved
			}
			limit, err := a.Queries.GetPlayerBetLimit(ctx, playerID)
			if err == nil {
				detail.BetLimit = &limit
			}
		}
	}

	SuccessDataResponse(c, detail)
}

type createMarketJson struct {
	MarketType string     `json:"market_type" binding:"required"`
	StartsAt   *time.Time `json:"starts_at"`
	ClosesAt   time.Time  `json:"closes_at" binding:"required"`
	// match_winner
	TargetPlayerID    string   `json:"target_player_id"`
	RequiredPlayerIDs []string `json:"required_player_ids"`
	GameID            *string  `json:"game_id"`
	// win_streak (also uses TargetPlayerID)
	StreakGameID *string `json:"streak_game_id"`
	WinsRequired *int32  `json:"wins_required"`
	MaxLosses    *int32  `json:"max_losses"`
}

func (a *API) CreateMarket(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if !user.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, "only admins can create markets")
		return
	}

	var payload createMarketJson
	if err := c.ShouldBindJSON(&payload); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	targetPlayerID, err := strconv.ParseInt(payload.TargetPlayerID, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid target_player_id")
		return
	}

	startsAt := time.Now()
	if payload.StartsAt != nil {
		if payload.StartsAt.Before(time.Now()) {
			ErrorResponse(c, http.StatusBadRequest, "starts_at не может быть в прошлом")
			return
		}
		startsAt = *payload.StartsAt
	}

	params := elo.CreateMarketParams{
		MarketType: payload.MarketType,
		StartsAt:   startsAt,
		ClosesAt:   payload.ClosesAt,
		CreatedBy:  user.ID,
	}

	switch payload.MarketType {
	case "match_winner":
		requiredIDs := make([]int32, 0, len(payload.RequiredPlayerIDs))
		for _, s := range payload.RequiredPlayerIDs {
			pid, err := strconv.ParseInt(s, 10, 32)
			if err != nil {
				ErrorResponse(c, http.StatusBadRequest, "invalid required_player_id: "+s)
				return
			}
			requiredIDs = append(requiredIDs, int32(pid))
		}
		var gameID *int32
		if payload.GameID != nil {
			gid, err := strconv.ParseInt(*payload.GameID, 10, 32)
			if err != nil {
				ErrorResponse(c, http.StatusBadRequest, "invalid game_id")
				return
			}
			gid32 := int32(gid)
			gameID = &gid32
		}
		params.MatchWinner = &elo.MatchWinnerCreateParams{
			TargetPlayerID:    int32(targetPlayerID),
			RequiredPlayerIDs: requiredIDs,
			GameID:            gameID,
		}

	case "win_streak":
		if payload.StreakGameID == nil || payload.WinsRequired == nil {
			ErrorResponse(c, http.StatusBadRequest, "win_streak requires streak_game_id and wins_required")
			return
		}
		gid, err := strconv.ParseInt(*payload.StreakGameID, 10, 32)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "invalid streak_game_id")
			return
		}
		params.WinStreak = &elo.WinStreakCreateParams{
			TargetPlayerID: int32(targetPlayerID),
			GameID:         int32(gid),
			WinsRequired:   *payload.WinsRequired,
			MaxLosses:      payload.MaxLosses,
		}

	default:
		ErrorResponse(c, http.StatusBadRequest, "unknown market_type: "+payload.MarketType)
		return
	}

	market, err := a.MarketService.CreateMarket(ctx, params)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data":   gin.H{"id": fmt.Sprintf("%d", market.ID)},
	})
}

func (a *API) DeleteMarket(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if !user.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, "only admins can delete markets")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid market id")
		return
	}

	if err := a.MatchService.DeleteMarketAndRecalculate(ctx, int32(id)); err != nil {
		if err == elo.ErrMarketNotOpen {
			ErrorResponse(c, http.StatusConflict, err.Error())
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (a *API) GetMarketsByMatchID(c *gin.Context) {
	ctx := c.Request.Context()

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid match id")
		return
	}

	rows, err := a.Queries.ListMarketsByResolutionMatch(ctx, pgtype.Int4{Int32: int32(id), Valid: true})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	result := make([]marketPoolsJson, 0, len(rows))
	for _, r := range rows {
		totalPool := r.YesPool + r.NoPool
		targetID, params := buildMarketParamsFromRow(r.MarketType, r.TargetPlayerID, r.RequiredPlayerIds, r.MwGameID, r.WsGameID, r.WinsRequired, r.MaxLosses)
		m := marketPoolsJson{
			ID:             fmt.Sprintf("%d", r.ID),
			MarketType:     r.MarketType,
			Status:         r.Status,
			YesPool:        r.YesPool,
			NoPool:         r.NoPool,
			YesCoeff:       calcCoefficient(r.YesPool, totalPool),
			NoCoeff:        calcCoefficient(r.NoPool, totalPool),
			TargetPlayerID: targetID,
			Params:         params,
		}
		if r.StartsAt.Valid {
			t := r.StartsAt.Time
			m.StartsAt = &t
		}
		if r.ClosesAt.Valid {
			t := r.ClosesAt.Time
			m.ClosesAt = &t
		}
		if r.CreatedAt.Valid {
			t := r.CreatedAt.Time
			m.CreatedAt = &t
		}
		if r.ResolvedAt.Valid {
			t := r.ResolvedAt.Time
			m.ResolvedAt = &t
		}
		if r.Status == "resolved_yes" || r.Status == "resolved_no" {
			if details, err := a.Queries.GetSettlementDetails(ctx, r.ID); err == nil {
				m.Settlement = make([]settlementDetailJson, len(details))
				for i, d := range details {
					m.Settlement[i] = settlementDetailJson{
						PlayerID:   fmt.Sprintf("%d", d.PlayerID),
						PlayerName: d.PlayerName,
						Staked:     d.Staked,
						Earned:     d.Earned,
					}
				}
			}
		}
		result = append(result, m)
	}

	SuccessDataResponse(c, result)
}

func (a *API) PlaceBet(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if !user.PlayerID.Valid {
		ErrorResponse(c, http.StatusForbidden, "у вас нет привязанного игрока")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid market id")
		return
	}

	var body struct {
		Outcome string  `json:"outcome" binding:"required"`
		Amount  float64 `json:"amount" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if body.Outcome != "yes" && body.Outcome != "no" {
		ErrorResponse(c, http.StatusBadRequest, "outcome must be 'yes' or 'no'")
		return
	}
	if body.Amount <= 0 {
		ErrorResponse(c, http.StatusBadRequest, "amount must be positive")
		return
	}

	if err := a.MarketService.PlaceBet(ctx, int32(id), user.PlayerID.Int32, body.Outcome, body.Amount); err != nil {
		switch err {
		case elo.ErrBetLimitExceeded:
			ErrorResponse(c, http.StatusUnprocessableEntity, err.Error())
		case elo.ErrMarketNotOpen:
			ErrorResponse(c, http.StatusConflict, err.Error())
		default:
			ErrorResponse(c, http.StatusInternalServerError, err)
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "success"})
}
