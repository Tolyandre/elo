package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ─── List ─────────────────────────────────────────────────────────────────────

func (a *API) ListTables(c *gin.Context) {
	tables, err := a.TableService.ListTables(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, tables)
}

// ─── Create ───────────────────────────────────────────────────────────────────

func (a *API) CreateTable(c *gin.Context) {
	playerID := MustGetCurrentPlayerID(c)
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return // error already written by MustGetCurrentUserId
	}

	var body struct {
		Id              string          `json:"id"`
		GameId          string          `json:"game_id"`
		HostClientToken string          `json:"host_client_token"`
		GameState       json.RawMessage `json:"game_state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if body.Id == "" {
		ErrorResponse(c, http.StatusBadRequest, "id is required")
		return
	}
	if body.GameId == "" {
		ErrorResponse(c, http.StatusBadRequest, "game_id is required")
		return
	}
	if len(body.GameState) == 0 {
		ErrorResponse(c, http.StatusBadRequest, "game_state is required")
		return
	}

	_ = playerID // host player_id is embedded in game_state; we use userID for ownership

	// The raw gin body bypasses the typed DTO layer, so the client-minted ids
	// arrive in their wire form (ADR-12).
	tableID, err := id.ParseTolerant(body.Id)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid id")
		return
	}
	gameID, err := id.ParseTolerant(body.GameId)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid game_id")
		return
	}

	table, err := a.TableService.CreateTable(c.Request.Context(), tableID, userID, gameID, body.HostClientToken, body.GameState)
	if errors.Is(err, elo.ErrUnknownGame) || errors.Is(err, elo.ErrInvalidState) {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"status": "success", "data": table})
}

// ─── Get ──────────────────────────────────────────────────────────────────────

func (a *API) GetTable(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	table, err := a.TableService.GetTable(c.Request.Context(), tableID)
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

// ─── Update state (host only, optimistic lock) ───────────────────────────────

func (a *API) UpdateTableState(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return
	}

	var body struct {
		Version   *int64          `json:"version"`
		GameState json.RawMessage `json:"game_state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if body.Version == nil {
		ErrorResponse(c, http.StatusBadRequest, "version is required")
		return
	}
	if len(body.GameState) == 0 {
		ErrorResponse(c, http.StatusBadRequest, "game_state is required")
		return
	}

	table, err := a.TableService.UpdateTableState(c.Request.Context(), tableID, userID, *body.Version, body.GameState)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrNotTableHost) {
		ErrorResponse(c, http.StatusForbidden, err.Error())
		return
	}
	if errors.Is(err, elo.ErrTableVersionConflict) {
		// The table changed since the caller last saw it (player submission or
		// the host's other device). Return the current state so the client can
		// merge its edit and retry instead of erasing the other writer's input.
		c.JSON(http.StatusConflict, gin.H{"status": "fail", "message": err.Error(), "data": table})
		return
	}
	if errors.Is(err, elo.ErrInvalidState) || errors.Is(err, elo.ErrUnknownGame) {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Join ─────────────────────────────────────────────────────────────────────

func (a *API) JoinTable(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	playerID := MustGetCurrentPlayerID(c)

	table, err := a.TableService.JoinTable(c.Request.Context(), tableID, playerID)
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

// ─── Submit player input ──────────────────────────────────────────────────────

func (a *API) SubmitTable(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	playerID := MustGetCurrentPlayerID(c)

	var input elo.TableSubmitInput
	if err := c.ShouldBindJSON(&input); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	table, err := a.TableService.SubmitTable(c.Request.Context(), tableID, playerID, input)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrWrongPhase) || errors.Is(err, elo.ErrPlayerNotInGame) || errors.Is(err, elo.ErrSlotAlreadySet) {
		ErrorResponse(c, http.StatusConflict, err.Error())
		return
	}
	if errors.Is(err, elo.ErrInvalidInput) || errors.Is(err, elo.ErrUnknownGame) || errors.Is(err, elo.ErrInvalidState) {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Host takeover ────────────────────────────────────────────────────────────

// TakeoverTable claims hosting for the requesting device. The current host
// may always re-claim (this is also host resume on another device); any
// other user needs edit permission, checked here from the user record.
func (a *API) TakeoverTable(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return // error already written by MustGetCurrentUserId
	}

	var body struct {
		HostClientToken string `json:"host_client_token"`
	}
	_ = c.ShouldBindJSON(&body) // body is optional

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	table, err := a.TableService.TakeoverTable(c.Request.Context(), tableID, userID, body.HostClientToken, user.AllowEditing)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if errors.Is(err, elo.ErrNotTableHost) {
		ErrorResponse(c, http.StatusForbidden, "hosting may only be claimed by the current host or an editor")
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	SuccessDataResponse(c, table)
}

// ─── Delete ───────────────────────────────────────────────────────────────────

func (a *API) DeleteTable(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))
	userID, err := MustGetCurrentUserId(c)
	if err != nil {
		return
	}

	// When the host saved the match, the client passes its id so the service
	// can broadcast a "saved" event to connected players before teardown.
	savedMatchID := parseIDParam(c.Query("match_id"))

	if err := a.TableService.DeleteTable(c.Request.Context(), tableID, userID, savedMatchID); err != nil {
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

// TableEvents streams the full table state: the current snapshot on connect,
// then every broadcast (state update, join, submission, saved).
func (a *API) TableEvents(c *gin.Context) {
	tableID := parseIDParam(c.Param("id"))

	table, err := a.TableService.GetTable(c.Request.Context(), tableID)
	if errors.Is(err, elo.ErrTableNotFound) {
		ErrorResponse(c, http.StatusNotFound, "table not found")
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Send current state immediately on connect
	initialPayload, err := json.Marshal(elo.SSEEvent{Type: "state", Data: table})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	a.serveSSE(c, func() (<-chan []byte, func()) {
		return a.Hub.Subscribe(elo.TableTopic(tableID))
	}, initialPayload)
}

