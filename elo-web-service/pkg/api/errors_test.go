package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func TestDomainStatusCode(t *testing.T) {
	pgUnique := &pgconn.PgError{Code: "23505"}
	pgFK := &pgconn.PgError{Code: "23503"}

	cases := []struct {
		name string
		err  error
		want int
	}{
		// 400 Bad Request
		{"too few players", elo.ErrTooFewPlayers, http.StatusBadRequest},
		{"date change too large", elo.ErrDateChangeTooLarge, http.StatusBadRequest},
		{"match date out of range", elo.ErrMatchDateOutOfRange, http.StatusBadRequest},
		{"foreign key violation", pgFK, http.StatusBadRequest},
		{"wrapped date change", fmt.Errorf("ctx: %w", elo.ErrDateChangeTooLarge), http.StatusBadRequest},

		// 403 Forbidden
		{"no linked player", elo.ErrPlayerHasNoLinkedPlayer, http.StatusForbidden},

		// 404 Not Found
		{"match not found", elo.ErrMatchNotFound, http.StatusNotFound},
		{"pgx no rows", pgx.ErrNoRows, http.StatusNotFound},
		{"wrapped no rows", fmt.Errorf("get: %w", pgx.ErrNoRows), http.StatusNotFound},

		// 409 Conflict
		{"history conflict", elo.ErrHistoryChangeConflict, http.StatusConflict},
		{"history conflict betting lock", elo.ErrHistoryChangeConflictBettingLock, http.StatusConflict},
		{"market not open", elo.ErrMarketNotOpen, http.StatusConflict},
		{"tournament member has matches", elo.ErrTournamentMemberHasMatches, http.StatusConflict},
		{"tournament dates narrow", elo.ErrTournamentDatesNarrowEloRange, http.StatusConflict},
		{"tournament has members", elo.ErrTournamentHasMembers, http.StatusConflict},
		{"player already linked", elo.ErrPlayerAlreadyLinked, http.StatusConflict},
		{"unique violation", pgUnique, http.StatusConflict},

		// 422 Unprocessable Entity
		{"bet limit exceeded", elo.ErrBetLimitExceeded, http.StatusUnprocessableEntity},

		// 500 Internal — unknown
		{"unknown error", errors.New("boom"), http.StatusInternalServerError},
		{"nil error", nil, http.StatusInternalServerError},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := domainStatusCode(c.err); got != c.want {
				t.Errorf("domainStatusCode(%v) = %d, want %d", c.err, got, c.want)
			}
		})
	}
}
