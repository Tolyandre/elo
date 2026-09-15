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

// TestWinStreak_EmptyGameListMeansAnyGame pins the "any game" convention for a
// win_streak market created without games — the same convention match_winner's
// empty game_ids has. The market must resolve Да on a win delivered in a game
// it never named; before the fix the empty list made every match skip and the
// streak stats count nothing, so the market silently resolved Нет at expiry.
func TestWinStreak_EmptyGameListMeansAnyGame(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "StreakAnyA")
	playerB := createTestPlayer(t, pool, "StreakAnyB")
	game1 := createTestGame(t, pool, "StreakGame1")
	game2 := createTestGame(t, pool, "StreakGame2")
	adminID := createTestAdmin(t, pool)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match to initialise bet limits (keeps the fixture close to the
	// other market tests even though this one places no bets).
	_, err := matchSvc.AddMatch(ctx, game1, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("warm-up match: %v", err)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "win_streak",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		WinStreak: &elo.WinStreakCreateParams{
			TargetPlayerID: playerA,
			GameIDs:        nil,
			WinsRequired:   1,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	outcomeYes := marketOutcomeID(t, ctx, marketSvc, market.ID, "yes", idpkg.ID(""))

	// The winning match is played in a game the market never named.
	_, err = matchSvc.AddMatch(ctx, game2, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("trigger match: %v", err)
	}

	q := db.New(pool)
	m, err := q.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "resolved" {
		t.Fatalf("market status = %q, want %q — an empty game list counts every game", m.Status, "resolved")
	}
	if m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcomeYes {
		t.Errorf("resolution_outcome = %v, want the yes outcome %q", m.ResolutionOutcome, outcomeYes)
	}
}
