//go:build integration

package integration_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// readBetFee returns the maker fee stored on a player's latest bet.
func readBetFee(t *testing.T, pool *pgxpool.Pool, marketID, playerID idpkg.ID) float64 {
	t.Helper()
	var fee float64
	err := pool.QueryRow(context.Background(),
		`SELECT fee FROM bets WHERE market_id = $1 AND player_id = $2 ORDER BY placed_at DESC, id`,
		marketID, playerID).Scan(&fee)
	if err != nil {
		t.Fatalf("read bet fee for %s: %v", playerID, err)
	}
	return fee
}

// guarantorRoleDelta returns the 'market_guarantor' settlement delta for a player.
func guarantorRoleDelta(t *testing.T, pool *pgxpool.Pool, marketID, playerID idpkg.ID) float64 {
	t.Helper()
	var delta float64
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(elo_staked + elo_earned, 0) FROM global_arena_settlement
		 WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market_guarantor'`,
		marketID, playerID).Scan(&delta)
	if err != nil {
		t.Fatalf("guarantor delta for %s: %v", playerID, err)
	}
	return delta
}

// liveProbabilities returns the market's current per-outcome probabilities.
func liveProbabilities(t *testing.T, svc elo.IMarketService, marketID idpkg.ID) map[idpkg.ID]float64 {
	t.Helper()
	m, err := svc.GetMarket(context.Background(), marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := svc.ListMarketOutcomesWithPools(context.Background(), marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	q := make([]float64, len(outcomes))
	for i, o := range outcomes {
		q[i] = o.Q
	}
	probs := elo.MarginalProbabilitiesN(q, m.LiquidityB)
	out := make(map[idpkg.ID]float64, len(outcomes))
	for i, o := range outcomes {
		out[o.ID] = probs[i]
	}
	return out
}

// TestMarketGuarantees_LiquidityGrowsAndPricesArePreserved walks the voluntary
// guarantor lifecycle: a guarantor-less market rejects bets, the first wager
// opens trading, a mid-market wager grows b while preserving every probability
// (q is rescaled), wagers over-subscribing L stop growing b, and a
// fee-charging guarantor makes buys pay a maker fee.
func TestMarketGuarantees_LiquidityGrowsAndPricesArePreserved(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "GuarA")
	playerB := createTestPlayer(t, pool, "GuarB")
	g1 := createTestPlayer(t, pool, "Guarantor1")
	g2 := createTestPlayer(t, pool, "Guarantor2")
	gameID := createTestGame(t, pool, "GuarGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:               newID(t),
		MarketType:       "match_winner",
		StartsAt:         time.Now().Add(-time.Minute),
		ClosesAt:         time.Now().Add(24 * time.Hour),
		CreatedBy:        adminID,
		MaxGuarantorLoss: 10,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// No guarantors yet: betting is refused.
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err == nil {
		t.Fatal("PlaceBet on a guarantor-less market must fail")
	}

	// First guarantor: b = min(10, 6)/ln(3); the fresh market is uniform.
	setBetLimit(t, pool, g1, 16)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, g1, 6, 0); err != nil {
		t.Fatalf("JoinAsGuarantee g1: %v", err)
	}
	if p := liveProbabilities(t, marketSvc, market.ID)[outcomeA]; math.Abs(p-1.0/3) > 1e-9 {
		t.Errorf("fresh market must be uniform, p(A) = %v", p)
	}

	// A bet moves the price; the guarantor charges no fee (fee_rate 0), so the
	// stored fee is zero.
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 3); err != nil {
		t.Fatalf("PlaceBet after first wager: %v", err)
	}
	if fee := readBetFee(t, pool, market.ID, playerA); fee != 0 {
		t.Errorf("zero-fee guarantors must charge no fee, got %v", fee)
	}
	postBet := liveProbabilities(t, marketSvc, market.ID)

	// A second, fee-charging wager joins mid-market: b grows from 6/ln(3) to
	// 10/ln(3) (Σrisk 12 capped at L = 10) and every probability must stay
	// exactly where it was (price-preserving rescale).
	setBetLimit(t, pool, g2, 16)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, g2, 6, 0.25); err != nil {
		t.Fatalf("JoinAsGuarantee g2: %v", err)
	}
	afterJoin := liveProbabilities(t, marketSvc, market.ID)
	for oid, before := range postBet {
		if math.Abs(afterJoin[oid]-before) > 1e-9 {
			t.Errorf("guarantee join moved p(%s): before %v, after %v", oid, before, afterJoin[oid])
		}
	}

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if wantB := 10 / math.Log(3); math.Abs(m.LiquidityB-wantB) > 1e-9 {
		t.Errorf("liquidity_b after two wagers = %v, want %v (capped at L/ln3)", m.LiquidityB, wantB)
	}

	// The fee-charging guarantor makes the next buy pay a maker fee: the
	// weighted market fee is (0·6 + 0.25·6)/12 = 0.125, and the fee equals
	// 4c·b·Δp of the buy.
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 1); err != nil {
		t.Fatalf("PlaceBet with fee: %v", err)
	}
	if fee := readBetFee(t, pool, market.ID, playerB); fee <= 0 {
		t.Fatalf("a fee-charging guarantor must produce a positive fee, got %v", fee)
	}
}

// TestMarketGuarantees_SettlementWithFees resolves a market whose guarantors
// charge different fees and verifies the ADR-20 settlement split: the fee pool
// goes to the fee-charging wager, the equity residual is pro-rata by risk, and
// the result stays zero-sum.
func TestMarketGuarantees_SettlementWithFees(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "FeeA")
	playerB := createTestPlayer(t, pool, "FeeB")
	feeGuarantor := createTestPlayer(t, pool, "FeeGuarantor")
	zeroGuarantor := createTestPlayer(t, pool, "ZeroGuarantor")
	gameID := createTestGame(t, pool, "FeeGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:               newID(t),
		MarketType:       "match_winner",
		StartsAt:         time.Now().Add(-time.Minute),
		ClosesAt:         time.Now().Add(24 * time.Hour),
		CreatedBy:        adminID,
		MaxGuarantorLoss: 16,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// Two guarantors: one charges 10%, one nothing. Equal risks of 8 ⇒ the
	// weighted market fee is 5%.
	setBetLimit(t, pool, feeGuarantor, 16)
	setBetLimit(t, pool, zeroGuarantor, 16)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, feeGuarantor, 8, 0.10); err != nil {
		t.Fatalf("JoinAsGuarantee feeGuarantor: %v", err)
	}
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, zeroGuarantor, 8, 0); err != nil {
		t.Fatalf("JoinAsGuarantee zeroGuarantor: %v", err)
	}

	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 2); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}
	feeA := readBetFee(t, pool, market.ID, playerA)
	feeB := readBetFee(t, pool, market.ID, playerB)

	// playerA wins: 1 winning share pays 1.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	// Guarantor results: the fee pool (feeA + feeB) belongs entirely to the
	// fee-charging wager; the equity residual (collected − paid) splits
	// pro-rata by risk (equal here).
	costA, costB := readBetCost(t, pool, market.ID, playerA), readBetCost(t, pool, market.ID, playerB)
	residual := costA + costB - 1 // paid = 1 winning share
	feeDelta := guarantorRoleDelta(t, pool, market.ID, feeGuarantor)
	zeroDelta := guarantorRoleDelta(t, pool, market.ID, zeroGuarantor)

	if math.Abs(feeDelta-(feeA+feeB+residual/2)) > 1e-6 {
		t.Errorf("fee guarantor delta = %.6f, want fee pool + half residual = %.6f", feeDelta, feeA+feeB+residual/2)
	}
	if math.Abs(zeroDelta-residual/2) > 1e-6 {
		t.Errorf("zero-fee guarantor delta = %.6f, want half residual = %.6f (no fee share)", zeroDelta, residual/2)
	}

	// Strict zero-sum across all market settlement rows (buyers + guarantors).
	var deltaSum float64
	rows, err := pool.Query(ctx, `SELECT elo_staked, elo_earned FROM global_arena_settlement WHERE market_id = $1`, market.ID)
	if err != nil {
		t.Fatalf("query settlements: %v", err)
	}
	for rows.Next() {
		var staked, earned float64
		if err := rows.Scan(&staked, &earned); err != nil {
			rows.Close()
			t.Fatalf("scan: %v", err)
		}
		deltaSum += staked + earned
	}
	rows.Close()
	if math.Abs(deltaSum) > 1e-6 {
		t.Errorf("settlement not zero-sum: Σ = %.6f", deltaSum)
	}
}

// TestMarketGuarantees_ReservedRiskBlocksBets verifies that guarantor risk is
// reserved against the betting limit (ADR-20 supersedes the ADR-10 exemption).
func TestMarketGuarantees_ReservedRiskBlocksBets(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "ResA")
	playerB := createTestPlayer(t, pool, "ResB")
	gameID := createTestGame(t, pool, "ResGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:               newID(t),
		MarketType:       "match_winner",
		StartsAt:         time.Now().Add(-time.Minute),
		ClosesAt:         time.Now().Add(24 * time.Hour),
		CreatedBy:        adminID,
		MaxGuarantorLoss: 16,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// playerA (bet limit 16 from the warm-up) risks 15 as guarantor; only ~1
	// of headroom remains, and a 10-share buy must now exceed the limit.
	setBetLimit(t, pool, playerA, 16)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, playerA, 15, 0); err != nil {
		t.Fatalf("JoinAsGuarantee: %v", err)
	}
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 10); err == nil {
		t.Fatal("a buy that exceeds the limit minus reserved risk must fail")
	}
}
