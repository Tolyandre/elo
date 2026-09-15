//go:build integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestMarketExpiry_TimeBasedSettlement verifies that adding a match with a date past a
// market's closes_at triggers time-based expiry and creates market_settlement rows.
func TestMarketExpiry_TimeBasedSettlement(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "ExpiryA")
	playerB := createTestPlayer(t, pool, "ExpiryB")
	guarantor := createTestPlayer(t, pool, "ExpiryBGuarantor")
	gameID := createTestGame(t, pool, "Go")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	// Market closes in the future so bets can be placed, but the match date is after closes_at
	// to trigger ExpireMarketsAtDate inside AddMatch.
	tExp := now.Add(30 * time.Minute)
	tMatch := now.Add(2 * time.Hour)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match (before market creation) to initialise bet limits.
	_, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, now.Add(-time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("warm-up match: %v", err)
	}

	// Create a win_streak market that expires before the trigger match.
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "win_streak",
		StartsAt:   now.Add(-time.Minute),
		ClosesAt:   tExp,
		CreatedBy:  adminID,
		WinStreak: &elo.WinStreakCreateParams{
			TargetPlayerID: playerA,
			GameIDs:        []idpkg.ID{gameID},
			WinsRequired:   3,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// Bet limit after starting-Elo warm-up match = K/(1+1) = 16; use 1-share buys.
	outcomeYes := marketOutcomeID(t, ctx, marketSvc, market.ID, "yes", "")
	outcomeNo := marketOutcomeID(t, ctx, marketSvc, market.ID, "no", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeYes, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeNo, 1); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Add a match whose date is past closes_at — ExpireMarketsAtDate cancels the market.
	_, err = matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 6, playerB: 4}, tMatch, newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch after expiry: %v", err)
	}

	// Market should no longer be open
	q := db.New(pool)
	m, err := q.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status == "open" {
		t.Errorf("market status = %q, expected it to be resolved or cancelled after expiry", m.Status)
	}

	// Both players must have a market_settlement rating row
	if c := marketSettlementRatingCount(t, pool, playerA); c != 1 {
		t.Errorf("playerA: expected 1 market_settlement row after expiry, got %d", c)
	}
	if c := marketSettlementRatingCount(t, pool, playerB); c != 1 {
		t.Errorf("playerB: expected 1 market_settlement row after expiry, got %d", c)
	}
}
