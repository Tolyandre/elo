//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// TestMarkets_IDCodecOutcomeRoundtrip guards the idcodec contract of the
// outcome identifiers (ADR-11): PlaceBet's outcome_id must carry the SHORT id
// form clients see in responses (the middleware decodes it to canonical before
// the handler runs), and Market.resolution_outcome_id must come back in the
// same short form as the market's outcome ids so the UI can match them.
//
// Regression history: the field was first shipped as "outcome" / "
// resolution_outcome" — not *_id keys, so idcodec left them untouched: bets
// with short outcome ids failed with ErrMarketOutcomeNotFound, and the
// resolved-market badge could never match the winning outcome.
func TestMarkets_IDCodecOutcomeRoundtrip(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, userID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)

	playerA, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000d1", Name: "MarketA"})
	playerB, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000d2", Name: "MarketB"})
	guarantor, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000d3", Name: "MarketGuarantor"})
	gameRow, _ := q.AddGame(ctx, db.AddGameParams{ID: "00000000-0000-0000-0000-0000000000d4", Name: "CodecGame"})

	// The betting user acts as playerA; a warm-up match gives them a bet limit.
	playerAID := playerA.ID
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: userID, PlayerID: &playerAID}); err != nil {
		t.Fatalf("link player: %v", err)
	}
	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	if _, err := matchSvc.AddMatch(ctx, gameRow.ID, map[string]float64{playerA.ID: 5, playerB.ID: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up match: %v", err)
	}

	// Create the market through HTTP with SHORT player ids — exercises the
	// target_player_ids decode on the way in.
	createBody := map[string]any{
		"id":                   uuid.MustParse("00000000-0000-0000-0000-0000000000d5").String(),
		"market_type":          "match_winner",
		"closes_at":            time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
		"target_player_ids":    []string{shortOf(t, playerA.ID), shortOf(t, playerB.ID)},
		"allow_other_players":  true,
		"guarantor_player_ids": []string{shortOf(t, guarantor.ID)},
	}
	createJSON, _ := json.Marshal(createBody)
	req := httptest.NewRequest(http.MethodPost, "/markets", strings.NewReader(string(createJSON)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /markets: %d: %s", w.Code, w.Body.String())
	}
	marketID := "00000000-0000-0000-0000-0000000000d5"

	// GET the market: outcomes come back with short ids.
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/markets/"+marketID, nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("GET /markets/{id}: %d: %s", w2.Code, w2.Body.String())
	}
	var marketResp struct {
		Data struct {
			Outcomes []struct {
				ID     string `json:"id"`
				Kind   string `json:"kind"`
				Player string `json:"player_id"`
				Price  float64 `json:"price"`
			} `json:"outcomes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &marketResp); err != nil {
		t.Fatalf("parse market: %v", err)
	}
	shortOutcomeID, shortOtherID := "", ""
	var price float64
	for _, o := range marketResp.Data.Outcomes {
		if o.Kind == "player" && o.Player == shortOf(t, playerA.ID) {
			shortOutcomeID = o.ID
			price = o.Price
		}
		if o.Kind == "other" {
			shortOtherID = o.ID
		}
	}
	if shortOutcomeID == "" || shortOtherID == "" {
		t.Fatalf("market outcomes incomplete: %+v", marketResp.Data.Outcomes)
	}
	if shortOutcomeID == playerA.ID {
		t.Fatalf("outcome id came back canonical (%s) — idcodec did not encode it", shortOutcomeID)
	}

	// Place a bet with the SHORT outcome id — the middleware must decode it to
	// canonical before the service compares it against market_outcomes ids.
	betBody := map[string]any{
		"id":             uuid.MustParse("00000000-0000-0000-0000-0000000000d6").String(),
		"outcome_id":     shortOutcomeID,
		"shares":         1,
		"expected_price": price,
	}
	betJSON, _ := json.Marshal(betBody)
	req3 := httptest.NewRequest(http.MethodPost, "/markets/"+marketID+"/bets", strings.NewReader(string(betJSON)))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)
	if w3.Code != http.StatusCreated {
		t.Fatalf("POST /markets/{id}/bets with short outcome_id: %d: %s (want 201)", w3.Code, w3.Body.String())
	}

	// The stored bet references the canonical outcome row id.
	var storedOutcome string
	if err := pool.QueryRow(ctx,
		`SELECT outcome FROM bets WHERE market_id = $1 AND player_id = $2`, marketID, playerA.ID,
	).Scan(&storedOutcome); err != nil {
		t.Fatalf("read stored bet: %v", err)
	}
	if storedOutcome == shortOutcomeID || storedOutcome != canonicalOf(t, shortOutcomeID) {
		t.Fatalf("stored bet outcome = %s, want the canonical uuid form of %s", storedOutcome, shortOutcomeID)
	}

	// Resolve the market (playerA wins sole) and check resolution_outcome_id
	// comes back SHORT and matches the outcome id — the resolved-market badge
	// depends on this.
	if _, err := matchSvc.AddMatch(ctx, gameRow.ID, map[string]float64{playerA.ID: 10, playerB.ID: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger match: %v", err)
	}
	w4 := httptest.NewRecorder()
	router.ServeHTTP(w4, httptest.NewRequest(http.MethodGet, "/markets/"+marketID, nil))
	if w4.Code != http.StatusOK {
		t.Fatalf("GET /markets/{id} after resolve: %d: %s", w4.Code, w4.Body.String())
	}
	var resolved struct {
		Data struct {
			Status             string  `json:"status"`
			ResolutionOutcomeID *string `json:"resolution_outcome_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w4.Body.Bytes(), &resolved); err != nil {
		t.Fatalf("parse resolved market: %v", err)
	}
	if resolved.Data.Status != "resolved" || resolved.Data.ResolutionOutcomeID == nil {
		t.Fatalf("market not resolved: %+v", resolved.Data)
	}
	if *resolved.Data.ResolutionOutcomeID != shortOutcomeID {
		t.Fatalf("resolution_outcome_id = %s, want the short id %s (must match outcomes[].id)", *resolved.Data.ResolutionOutcomeID, shortOutcomeID)
	}
}

// shortOf encodes a canonical uuid to the short Base58 form the API boundary
// uses (same codec as the idcodec middleware).
func shortOf(t *testing.T, canonical string) string {
	t.Helper()
	return shortid.FromCanonical(canonical)
}

// canonicalOf decodes a short id back to canonical form.
func canonicalOf(t *testing.T, short string) string {
	t.Helper()
	return shortid.ToCanonical(short)
}

// createTestUserWithID is createTestUser that also returns the user id (the
// market test needs it to link a player to the betting user).
func createTestUserWithID(t *testing.T, pool *pgxpool.Pool, allowEditing bool) (token string, userID string) {
	t.Helper()
	queries := db.New(pool)
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	userID, err = queries.CreateUser(context.Background(), db.CreateUserParams{
		ID:                  uid.String(),
		AllowEditing:        allowEditing,
		GoogleOauthUserID:   "market-codec-user-" + uid.String(),
		GoogleOauthUserName: "Market Codec User",
	})
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	token, err = apioauth2.CreateJwt(time.Hour, userID, testJWTSecret)
	if err != nil {
		t.Fatalf("create JWT: %v", err)
	}
	return token, userID
}
