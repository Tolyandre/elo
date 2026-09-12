//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestShortPathAndQueryParams guards the wire-form parsing of path and query
// parameters (ADR-12): handlers convert them via id.ParseTolerant now that the
// idcodec middleware is gone.
//
// Regression history: server_markets.go was missed by the conversion sweep —
// GET /markets/{short-id} kept the Base58 string in the canonical slot and
// returned 404, and GET /matches/{short-id}/markets leaked it into Postgres
// (SQLSTATE 22P02). The same class of bug existed for the game_id/player_id/
// club_id query filters on GET /matches.
func TestShortPathAndQueryParams(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, userID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)
	playerA, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000e1", Name: "PathA"})
	playerB, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000e2", Name: "PathB"})
	gameRow, _ := q.AddGame(ctx, db.AddGameParams{ID: "00000000-0000-0000-0000-0000000000e3", Name: "PathGame"})

	marketSvc := elo.NewMarketService(pool)
	matchSvc := elo.NewMatchService(pool, marketSvc)

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         idpkg.ID("00000000-0000-0000-0000-0000000000e4"),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  idpkg.ID(userID),
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA.ID, playerB.ID},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("create market: %v", err)
	}
	setBetLimit(t, pool, playerA.ID, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, playerA.ID)
	_ = token

	// GET /markets/{id} with the SHORT id — regression: returned 404 when the
	// path param kept its wire form.
	shortMarket := string(market.ID.Base58())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/markets/"+shortMarket, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /markets/{short id}: %d: %s (want 200)", w.Code, w.Body.String())
	}

	// A match that resolves the market gives /matches/{id}/markets a row.
	match, err := matchSvc.AddMatch(ctx, gameRow.ID, map[idpkg.ID]float64{playerA.ID: 10, playerB.ID: 2}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("add resolving match: %v", err)
	}
	shortMatch := string(match.ID.Base58())
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/matches/"+shortMatch+"/markets", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("GET /matches/{short id}/markets: %d: %s (want 200)", w2.Code, w2.Body.String())
	}
	var byMatch struct {
		Data []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &byMatch); err != nil {
		t.Fatalf("parse markets-by-match: %v", err)
	}
	if len(byMatch.Data) == 0 || byMatch.Data[0].ID != shortMarket {
		t.Fatalf("markets by match = %+v, want the market %s", byMatch.Data, shortMarket)
	}

	// Query filters carry wire-form ids too.
	shortGame := string(gameRow.ID.Base58())
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, httptest.NewRequest(http.MethodGet, "/matches?game_id="+shortGame, nil))
	if w3.Code != http.StatusOK {
		t.Fatalf("GET /matches?game_id={short id}: %d: %s (want 200)", w3.Code, w3.Body.String())
	}
}
