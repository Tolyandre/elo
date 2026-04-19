package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

// ─── List ─────────────────────────────────────────────────────────────────────

func (a *API) ListSkullKingTables(c *gin.Context) {
	tables, err := a.SkullKingTableService.ListTables(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, tables)
}

// ─── Create ───────────────────────────────────────────────────────────────────

func (a *API) CreateSkullKingTable(c *gin.Context) {
	playerID := MustGetCurrentPlayerID(c)
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return // error already written by MustGetCurrentUserId
	}

	var body struct {
		GameState json.RawMessage `json:"game_state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if len(body.GameState) == 0 {
		ErrorResponse(c, http.StatusBadRequest, "game_state is required")
		return
	}

	_ = playerID // host player_id is embedded in game_state; we use userID for ownership

	table, err := a.SkullKingTableService.CreateTable(c.Request.Context(), userID, body.GameState)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"status": "success", "data": table})
}

// ─── Get ──────────────────────────────────────────────────────────────────────

func (a *API) GetSkullKingTable(c *gin.Context) {
	tableID := c.Param("id")
	table, err := a.SkullKingTableService.GetTable(c.Request.Context(), tableID)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Update state (host only) ─────────────────────────────────────────────────

func (a *API) UpdateSkullKingTableState(c *gin.Context) {
	tableID := c.Param("id")
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return
	}

	var body struct {
		GameState json.RawMessage `json:"game_state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if len(body.GameState) == 0 {
		ErrorResponse(c, http.StatusBadRequest, "game_state is required")
		return
	}

	table, err := a.SkullKingTableService.UpdateTableState(c.Request.Context(), tableID, userID, body.GameState)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrNotTableHost) {
		ErrorResponse(c, http.StatusForbidden, err.Error())
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Join ─────────────────────────────────────────────────────────────────────

func (a *API) JoinSkullKingTable(c *gin.Context) {
	tableID := c.Param("id")
	playerID := MustGetCurrentPlayerID(c)

	table, err := a.SkullKingTableService.JoinTable(c.Request.Context(), tableID, playerID)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Submit bid ───────────────────────────────────────────────────────────────

func (a *API) SubmitSkullKingBid(c *gin.Context) {
	tableID := c.Param("id")
	playerID := MustGetCurrentPlayerID(c)

	var body struct {
		Bid int `json:"bid"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	table, err := a.SkullKingTableService.SubmitBid(c.Request.Context(), tableID, playerID, body.Bid)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrWrongPhase) || errors.Is(err, elo.ErrPlayerNotInGame) || errors.Is(err, elo.ErrSlotAlreadySet) {
		ErrorResponse(c, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Submit result ────────────────────────────────────────────────────────────

func (a *API) SubmitSkullKingResult(c *gin.Context) {
	tableID := c.Param("id")
	playerID := MustGetCurrentPlayerID(c)

	var body struct {
		Actual int `json:"actual"`
		Bonus  int `json:"bonus"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	table, err := a.SkullKingTableService.SubmitResult(c.Request.Context(), tableID, playerID, body.Actual, body.Bonus)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrWrongPhase) || errors.Is(err, elo.ErrPlayerNotInGame) || errors.Is(err, elo.ErrSlotAlreadySet) {
		ErrorResponse(c, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Delete ───────────────────────────────────────────────────────────────────

func (a *API) DeleteSkullKingTable(c *gin.Context) {
	tableID := c.Param("id")
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return
	}

	if err := a.SkullKingTableService.DeleteTable(c.Request.Context(), tableID, userID); err != nil {
		if errors.Is(err, elo.ErrTableNotFound) {
			ErrorResponse(c, http.StatusNotFound, "table not found")
			return
		}
		if errors.Is(err, elo.ErrNotTableHost) {
			ErrorResponse(c, http.StatusForbidden, err.Error())
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── SSE events stream ────────────────────────────────────────────────────────

func (a *API) SkullKingTableEvents(c *gin.Context) {
	tableID := c.Param("id")
	ctx := c.Request.Context()

	table, err := a.SkullKingTableService.GetTable(ctx, tableID)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	ch, cancel := a.SkullKingHub.Subscribe(tableID)
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Send current state immediately on connect
	initialPayload, err := json.Marshal(sseTableEvent{Type: "state", Data: table})
	if err == nil {
		fmt.Fprintf(c.Writer, "data: %s\n\n", initialPayload)
		c.Writer.Flush()
	}

	clientGone := ctx.Done()
	for {
		select {
		case <-clientGone:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(c.Writer, "data: %s\n\n", msg)
			c.Writer.Flush()
		}
	}
}

type sseTableEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}
