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
		errors.Is(err, elo.ErrCampArenaInvalid),
		errors.Is(err, elo.ErrCampDatesRequired),
		errors.Is(err, elo.ErrCampDatesInvalid),
		errors.Is(err, elo.ErrCampLeaguesNotAllowed),
		errors.Is(err, elo.ErrArenaNameTaken),
		errors.Is(err, elo.ErrTournamentNameRequired),
		errors.Is(err, elo.ErrTournamentEliminationInvalid),
		errors.Is(err, elo.ErrTournamentPoolEntryInvalid),
		errors.Is(err, elo.ErrTournamentDeadlineInvalid),
		errors.Is(err, elo.ErrTournamentTooFewParticipants),
		errors.Is(err, elo.ErrTournamentPoolEmpty),
		errors.Is(err, elo.ErrTournamentPlanInvalid),
		errors.Is(err, elo.ErrTournamentRulingInvalid),
		errors.Is(err, elo.ErrTournamentSlotAdjustInvalid),
		errors.Is(err, elo.ErrTournamentMatchFitsNoSlot),
		errors.Is(err, elo.ErrGrandFinalDeadlinePassed),
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
		errors.Is(err, elo.ErrCampDatesExcludeMatch),
		errors.Is(err, elo.ErrMatchOutsideCampWindows),
		errors.Is(err, elo.ErrArenaIsAutoManaged),
		errors.Is(err, elo.ErrGlobalArenaIsPermanent),
		errors.Is(err, elo.ErrPlayerAlreadyLinked),
		errors.Is(err, elo.ErrTournamentNotEditable),
		errors.Is(err, elo.ErrTournamentNotOpenForRegistration),
		errors.Is(err, elo.ErrTournamentNotRunning),
		errors.Is(err, elo.ErrTournamentAlreadyStarted),
		errors.Is(err, elo.ErrTournamentNotStarted),
		errors.Is(err, elo.ErrSlotAssociationLocked),
		errors.Is(err, elo.ErrMatchAlreadyLinked),
		errors.Is(err, elo.ErrTournamentMatchNotLinked),
		errors.Is(err, elo.ErrTournamentSlotNotPlaying),
		db.IsUniqueViolation(err):
		return http.StatusConflict

	// --- 422 Unprocessable Entity: semantically valid but rule-violating ----
	case errors.Is(err, elo.ErrBetLimitExceeded):
		return http.StatusUnprocessableEntity

	default:
		return http.StatusInternalServerError
	}
}
