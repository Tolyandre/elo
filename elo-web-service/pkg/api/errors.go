package api

import (
	"errors"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// domainStatusCode maps a service/DB error to the HTTP status code a handler
// should return. It is the single authoritative table for the project's
// domain→HTTP classification: it encodes the elo sentinel errors, the pgx
// constraint-violation predicates, and the not-found case.
//
// Handlers still own their typed oapi-codegen response objects (each operation
// has a distinct XxxNNNJSONResponse type), but they call this helper to decide
// *which* status applies instead of re-implementing the classification inline.
// Unknown errors fall through to 500 and are surfaced by errorMiddleware in
// main.go as {"status":"fail","message":...}.
//
// Callers that want a 4xx body with a resource-specific message (e.g. "player
// not found" vs "club not found") construct the typed response themselves:
//
//	switch domainStatusCode(err) {
//	case http.StatusNotFound:  return PatchPlayer404JSONResponse{...}, nil
//	case http.StatusConflict:  return PatchPlayer409JSONResponse{...}, nil
//	default:                   return nil, err
//	}
func domainStatusCode(err error) int {
	switch {
	// --- 400 Bad Request: invalid input / referential integrity ------------
	case errors.Is(err, elo.ErrTooFewPlayers),
		errors.Is(err, elo.ErrDateChangeTooLarge),
		errors.Is(err, elo.ErrMatchDateOutOfRange),
		db.IsForeignKeyViolation(err):
		return http.StatusBadRequest

	// --- 403 Forbidden: authenticated but lacking a linked player -----------
	case errors.Is(err, elo.ErrPlayerHasNoLinkedPlayer):
		return http.StatusForbidden

	// --- 404 Not Found ------------------------------------------------------
	case errors.Is(err, elo.ErrMatchNotFound),
		db.IsNoRows(err):
		return http.StatusNotFound

	// --- 409 Conflict: concurrent / uniqueness / business conflict ----------
	case errors.Is(err, elo.ErrHistoryChangeConflict),
		errors.Is(err, elo.ErrHistoryChangeConflictBettingLock),
		errors.Is(err, elo.ErrMarketNotOpen),
		errors.Is(err, elo.ErrTournamentMemberHasMatches),
		errors.Is(err, elo.ErrTournamentDatesNarrowEloRange),
		errors.Is(err, elo.ErrTournamentHasMembers),
		errors.Is(err, elo.ErrPlayerAlreadyLinked),
		db.IsUniqueViolation(err):
		return http.StatusConflict

	// --- 422 Unprocessable Entity: semantically valid but rule-violating ----
	case errors.Is(err, elo.ErrBetLimitExceeded):
		return http.StatusUnprocessableEntity

	default:
		return http.StatusInternalServerError
	}
}
