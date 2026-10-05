package api

import (
	"context"
	"encoding/json"
	"errors"

	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Strict handlers for the live game-table routes (ADR-18). The table's
// game_state is an opaque document at the OpenAPI layer: requests and
// responses carry it through the generated TableGameState union untouched
// (passthrough Marshal/Unmarshal), so the stored bytes reach the client
// exactly as the game's typed state wrote them.

// rawGameState / tableGameState bridge the opaque game_state document between
// its wire bytes and the generated passthrough union (same package, so the
// unexported raw field is reachable here and nowhere else needs to know).
func rawGameState(gs TableGameState) json.RawMessage { return gs.union }

func tableGameState(raw json.RawMessage) TableGameState { return TableGameState{union: raw} }

// SubmitTableJSONRequestBody is generated as a defined type, which does not
// inherit the underlying union's methods — without this hook encoding/json
// would silently skip the unexported raw field and every submit would see an
// empty body. Forward to the union's passthrough UnmarshalJSON.
func (t *SubmitTableJSONRequestBody) UnmarshalJSON(b []byte) error {
	return (*SubmitTableJSONBody)(t).UnmarshalJSON(b)
}

func tableSummaryFromElo(t elo.TableSummary) TableSummary {
	return TableSummary{
		Id:                 t.ID,
		GameId:             t.GameID,
		HostUserId:         t.HostUserID,
		HostClientToken:    t.HostClientToken,
		GameState:          tableGameState(t.GameState),
		ConnectedPlayerIds: t.ConnectedPlayerIDs,
		Version:            t.Version,
		CreatedAt:          t.CreatedAt,
		ExpiresAt:          t.ExpiresAt,
	}
}

// currentUserID reads the authenticated user behind editorAuth/playerAuth.
func currentUserID(ctx context.Context) (id.ID, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return "", errors.New("no request context")
	}
	return MustGetCurrentUserId(ginCtx)
}

// currentPlayerID reads the player id set by the RequirePlayerID middleware.
func currentPlayerID(ctx context.Context) (id.ID, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return "", errors.New("no request context")
	}
	return MustGetCurrentPlayerID(ginCtx), nil
}

func (s *StrictServer) ListTables(ctx context.Context, _ ListTablesRequestObject) (ListTablesResponseObject, error) {
	tables, err := s.api.TableService.ListTables(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]TableSummary, 0, len(tables))
	for _, t := range tables {
		out = append(out, tableSummaryFromElo(t))
	}
	return ListTables200JSONResponse{Status: StatusSuccess, Data: out}, nil
}

func (s *StrictServer) CreateTable(ctx context.Context, request CreateTableRequestObject) (CreateTableResponseObject, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return nil, err
	}

	body := request.Body
	// The typed Base58ID fields skip UnmarshalJSON when a field is absent, so
	// zero values here mean "missing" (the service validates the rest).
	if body.Id.IsZero() {
		return CreateTable400JSONResponse{Status: StatusFail, Message: "id is required"}, nil
	}
	if body.GameId.IsZero() {
		return CreateTable400JSONResponse{Status: StatusFail, Message: "game_id is required"}, nil
	}
	if len(rawGameState(body.GameState)) == 0 {
		return CreateTable400JSONResponse{Status: StatusFail, Message: "game_state is required"}, nil
	}

	hostClientToken := ""
	if body.HostClientToken != nil {
		hostClientToken = *body.HostClientToken
	}

	// Host player_id is embedded in game_state; ownership is tracked by userID.
	table, err := s.api.TableService.CreateTable(ctx, body.Id, userID, body.GameId, hostClientToken, rawGameState(body.GameState))
	if errors.Is(err, elo.ErrUnknownGame) || errors.Is(err, elo.ErrInvalidState) {
		return CreateTable400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
	}
	if err != nil {
		return nil, err
	}
	return CreateTable201JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

func (s *StrictServer) GetTable(ctx context.Context, request GetTableRequestObject) (GetTableResponseObject, error) {
	table, err := s.api.TableService.GetTable(ctx, parseIDParam(request.Id))
	if errors.Is(err, elo.ErrTableNotFound) {
		return GetTable404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
	}
	if err != nil {
		return nil, err
	}
	return GetTable200JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

func (s *StrictServer) UpdateTableState(ctx context.Context, request UpdateTableStateRequestObject) (UpdateTableStateResponseObject, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return nil, err
	}

	table, err := s.api.TableService.UpdateTableState(ctx, parseIDParam(request.Id), userID, request.Body.Version, rawGameState(request.Body.GameState))
	if errors.Is(err, elo.ErrTableNotFound) {
		return UpdateTableState404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
	}
	if errors.Is(err, elo.ErrNotTableHost) {
		return UpdateTableState403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
	}
	if errors.Is(err, elo.ErrTableVersionConflict) {
		// The table changed since the caller last saw it (player submission or
		// the host's other device). Return the current state so the client can
		// merge its edit and retry instead of erasing the other writer's input.
		return UpdateTableState409JSONResponse{Status: StatusFail, Message: err.Error(), Data: tableSummaryFromElo(table)}, nil
	}
	if errors.Is(err, elo.ErrInvalidState) || errors.Is(err, elo.ErrUnknownGame) {
		return UpdateTableState400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
	}
	if err != nil {
		return nil, err
	}
	return UpdateTableState200JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

func (s *StrictServer) JoinTable(ctx context.Context, request JoinTableRequestObject) (JoinTableResponseObject, error) {
	playerID, err := currentPlayerID(ctx)
	if err != nil {
		return nil, err
	}

	table, err := s.api.TableService.JoinTable(ctx, parseIDParam(request.Id), playerID)
	if errors.Is(err, elo.ErrTableNotFound) {
		return JoinTable404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
	}
	if err != nil {
		return nil, err
	}
	return JoinTable200JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

func (s *StrictServer) SubmitTable(ctx context.Context, request SubmitTableRequestObject) (SubmitTableResponseObject, error) {
	playerID, err := currentPlayerID(ctx)
	if err != nil {
		return nil, err
	}

	// The raw submit body goes to the table's game, which decodes its own
	// input shape and maps decode failures to ErrInvalidInput (400).
	table, err := s.api.TableService.SubmitTable(ctx, parseIDParam(request.Id), playerID, request.Body.union)
	if errors.Is(err, elo.ErrTableNotFound) {
		return SubmitTable404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
	}
	if errors.Is(err, elo.ErrWrongPhase) || errors.Is(err, elo.ErrPlayerNotInGame) || errors.Is(err, elo.ErrSlotAlreadySet) {
		return SubmitTable409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
	}
	if errors.Is(err, elo.ErrInvalidInput) || errors.Is(err, elo.ErrUnknownGame) || errors.Is(err, elo.ErrInvalidState) {
		return SubmitTable400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
	}
	if err != nil {
		return nil, err
	}
	return SubmitTable200JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

// TakeoverTable claims hosting for the requesting device. The current host
// may always re-claim (this is also host resume on another device); any
// other user needs edit permission, checked here from the user record.
func (s *StrictServer) TakeoverTable(ctx context.Context, request TakeoverTableRequestObject) (TakeoverTableResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, errors.New("no request context")
	}
	userID, err := MustGetCurrentUserId(ginCtx)
	if err != nil {
		return nil, err
	}

	hostClientToken := ""
	if request.Body != nil && request.Body.HostClientToken != nil {
		hostClientToken = *request.Body.HostClientToken
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		return nil, err
	}

	table, err := s.api.TableService.TakeoverTable(ctx, parseIDParam(request.Id), userID, hostClientToken, user.AllowEditing)
	if errors.Is(err, elo.ErrTableNotFound) {
		return TakeoverTable404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
	}
	if errors.Is(err, elo.ErrNotTableHost) {
		return TakeoverTable403JSONResponse{Status: StatusFail, Message: "hosting may only be claimed by the current host or an editor"}, nil
	}
	if err != nil {
		return nil, err
	}
	return TakeoverTable200JSONResponse{Status: StatusSuccess, Data: tableSummaryFromElo(table)}, nil
}

func (s *StrictServer) DeleteTable(ctx context.Context, request DeleteTableRequestObject) (DeleteTableResponseObject, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return nil, err
	}

	// When the host saved the match, the client passes its id so the service
	// can broadcast a "saved" event to connected players before teardown.
	var savedMatchID id.ID
	if request.Params.MatchId != nil {
		savedMatchID = parseIDParam(*request.Params.MatchId)
	}

	if err := s.api.TableService.DeleteTable(ctx, parseIDParam(request.Id), userID, savedMatchID); err != nil {
		if errors.Is(err, elo.ErrTableNotFound) {
			return DeleteTable404JSONResponse{Status: StatusFail, Message: "table not found"}, nil
		}
		if errors.Is(err, elo.ErrNotTableHost) {
			return DeleteTable403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}
	return DeleteTable204Response{}, nil
}
