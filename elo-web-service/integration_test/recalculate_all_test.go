//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestRecalculateAllArenas_NoDriftOnUnchangedHistory exercises the /debug
// endpoint's backend: replaying every arena from scratch (match settlements
// per arena, then the settlement sweep) must reproduce every player's state
// bit-for-bit — «Синие люди»'s main arena included.
//
// Complements TestRecalculation_IdempotencyForMarkets, which triggers the same
// replay via an identical edit of the first match — here the "from the
// beginning" entry point runs directly, and the endpoint's diff report itself
// is the assertion. Any entry in ChangedPlayers is a real ordering or
// state-dependence bug in settlement, not test noise.
func TestRecalculateAllArenas_NoDriftOnUnchangedHistory(t *testing.T) {
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
		TenantID:   blueMenTenantID,
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
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
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

	for run := 1; run <= 2; run++ {
		reports, err := newArenaService(pool).RecalculateAllArenas(ctx)
		if err != nil {
			t.Fatalf("run %d: RecalculateAllArenas: %v", run, err)
		}
		main := slices.IndexFunc(reports, func(r elo.ArenaUpdateReport) bool {
			return r.ArenaID == elo.BlueMenArenaID
		})
		if main < 0 {
			t.Fatalf("run %d: no report for «Синие люди»'s main arena, want every arena reported", run)
		}
		if reports[main].MatchesReplayed != 3 {
			t.Errorf("run %d: MatchesReplayed = %d, want 3", run, reports[main].MatchesReplayed)
		}
		if len(reports[main].ChangedPlayers) != 0 {
			t.Errorf("run %d: ChangedPlayers = %+v, want none (A, B, guarantor must all reproduce exactly)", run, reports[main].ChangedPlayers)
		}
	}
}

// TestTenantSettingsChange_RecalculatesFromNewStartingRating pins the fix for
// the settings-replay staleness bug (ADR-36 phase 6): changing «Синие люди»'s
// starting rating through the tenant queues the arena, and the drain must
// re-derive every player's rating from the NEW document — not the previous
// one (the replay used to read the arena outside the save transaction).
func TestTenantSettingsChange_RecalculatesFromNewStartingRating(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	game := createTestGame(t, pool, "Игра синих рейтингов")
	svc := newMatchService(pool)
	member := createTestPlayer(t, pool, "Синий рейтинговый")
	opponent := createBareTestPlayer(t, pool, "Рейтинговый гость")
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, opponent: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	readStartingRating := func() float64 {
		t.Helper()
		var doc []byte
		if err := pool.QueryRow(ctx,
			`SELECT settings FROM arenas WHERE id = $1`, elo.BlueMenArenaID).Scan(&doc); err != nil {
			t.Fatalf("read arena settings: %v", err)
		}
		var parsed struct {
			StartingRating float64 `json:"starting_rating"`
		}
		if err := json.Unmarshal(doc, &parsed); err != nil {
			t.Fatalf("decode arena settings: %v", err)
		}
		return parsed.StartingRating
	}

	// The player's full settlement chain: a replay against the OLD starting
	// rating reproduces it bit-for-bit, so "the chain moved" is exactly the
	// bug signature this test pins.
	chain := func() []float64 {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT rating_after FROM arena_settlements
			 WHERE arena_id = $1 AND player_id = $2
			 ORDER BY date ASC, id ASC`, elo.BlueMenArenaID, member)
		if err != nil {
			t.Fatalf("read settlements: %v", err)
		}
		defer rows.Close()
		var out []float64
		for rows.Next() {
			var v float64
			if err := rows.Scan(&v); err != nil {
				t.Fatalf("scan settlement: %v", err)
			}
			out = append(out, v)
		}
		return out
	}

	before := chain()
	w := doJSON(t, router, http.MethodPatch, "/tenants/"+blueMenTenantUUID, token,
		`{"settings": {"starting_rating": 100, "leagues": []}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant settings: %d %s", w.Code, w.Body.String())
	}
	if got := readStartingRating(); got != 100 {
		t.Fatalf("starting rating = %v, want 100 after the PATCH", got)
	}
	drainArenas(t, pool)

	// The drain re-derived the history from the NEW document. A replay that
	// read the pre-change settings (the bug this pins: the arena row was read
	// outside the save transaction) would have reproduced `before` exactly.
	after := chain()
	if slices.Equal(before, after) {
		t.Fatalf("settlement chain unchanged after the starting-rating change (%v), want a re-derivation from starting_rating=100", before)
	}
}
