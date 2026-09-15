//go:build integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestRecalculateAllGlobalElo_NoDriftOnUnchangedHistory exercises the /debug
// endpoint's backend: a full replay of the settlement history (matches, a
// market resolution and a correction) from the beginning of time must
// reproduce every player's global arena state bit-for-bit.
//
// Complements TestRecalculation_IdempotencyForMarkets, which triggers the same
// replay via an identical edit of the first match — here the "from the
// beginning" entry point runs directly, and the endpoint's diff report itself
// is the assertion. Any entry in ChangedPlayers is a real ordering or
// state-dependence bug in settlement, not test noise.
func TestRecalculateAllGlobalElo_NoDriftOnUnchangedHistory(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "ReplayA")
	playerB := createTestPlayer(t, pool, "ReplayB")
	guarantor := createTestPlayer(t, pool, "ReplayGuarantor")
	gameID := createTestGame(t, pool, "Replay")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	t1 := now.Add(-3 * time.Hour)
	t2 := now.Add(-2 * time.Hour)
	t3 := now.Add(-1 * time.Hour)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// M1, then a match_winner market (starts after M1 so only M2 can resolve
	// it), bets on both sides, M2 resolves the market, M3 afterwards — the
	// interleaving where a stale-read ordering bug would show up.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, t1, newMatchOpts(t)); err != nil {
		t.Fatalf("M1 AddMatch: %v", err)
	}
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   t1.Add(30 * time.Minute),
		ClosesAt:   now.Add(24 * time.Hour),
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
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 1); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, t2, newMatchOpts(t)); err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 7, playerB: 8}, t3, newMatchOpts(t)); err != nil {
		t.Fatalf("M3 AddMatch: %v", err)
	}

	// A manual correction after all matches: the replay's third event kind.
	correctionSvc := newCorrectionService(pool)
	if err := correctionSvc.CreateGlobalArenaRatingCorrection(ctx, newID(t), playerB, 3.5); err != nil {
		t.Fatalf("CreateGlobalArenaRatingCorrection: %v", err)
	}

	for run := 1; run <= 2; run++ {
		report, err := matchSvc.RecalculateAllGlobalElo(ctx)
		if err != nil {
			t.Fatalf("run %d: RecalculateAllGlobalElo: %v", run, err)
		}
		if report.MatchesReplayed != 3 {
			t.Errorf("run %d: MatchesReplayed = %d, want 3", run, report.MatchesReplayed)
		}
		if report.CorrectionsReplayed != 1 {
			t.Errorf("run %d: CorrectionsReplayed = %d, want 1", run, report.CorrectionsReplayed)
		}
		if len(report.ChangedPlayers) != 0 {
			t.Errorf("run %d: ChangedPlayers = %+v, want none (A, B, guarantor must all reproduce exactly)", run, report.ChangedPlayers)
		}
	}
}
