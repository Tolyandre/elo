//go:build integration

package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestPlaceBet_ExpectedProbabilityValidation verifies that a buy is accepted around the
// probability the buyer saw: PlaceBet rejects an expected_probability that has drifted
// beyond elo.ProbabilityTolerance and accepts one within it.
func TestPlaceBet_ExpectedProbabilityValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "PriceA")
	playerB := createTestPlayer(t, pool, "PriceB")
	guarantor := createTestPlayer(t, pool, "PriceGuarantor")
	gameID := createTestGame(t, pool, "Poker")
	adminID := createTestAdmin(t, pool)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// Warm-up match so the players have a bet limit.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	m, err := marketSvc.Queries.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := marketSvc.Queries.ListMarketOutcomesWithPools(ctx, market.ID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	q := make([]float64, len(outcomes))
	var outcomeA idpkg.ID
	priceA := -1.0
	for i, o := range outcomes {
		q[i] = o.Q
		if o.Kind == "player" && o.PlayerID != nil && *o.PlayerID == playerA {
			outcomeA = o.ID
			priceA = elo.MarginalProbabilitiesN(q, m.LiquidityB)[i]
		}
	}
	if outcomeA.IsZero() {
		t.Fatalf("playerA outcome not found on market %s", market.ID)
	}

	// A stale price (an old snapshot, or the market moved) must be rejected.
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, playerA, outcomeA, 1, priceA-0.05); !errors.Is(err, elo.ErrProbabilityChanged) {
		t.Fatalf("PlaceBet with stale price: err = %v, want ErrProbabilityChanged", err)
	}

	// A price within the tolerance is accepted.
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, playerA, outcomeA, 1, priceA-elo.ProbabilityTolerance/2); err != nil {
		t.Fatalf("PlaceBet with fresh price: %v", err)
	}

	// An outcome id that is not one of the market's outcomes is rejected.
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, playerA, newID(t), 1, 0.5); !errors.Is(err, elo.ErrMarketOutcomeNotFound) {
		t.Fatalf("PlaceBet with unknown outcome: err = %v, want ErrMarketOutcomeNotFound", err)
	}
}
