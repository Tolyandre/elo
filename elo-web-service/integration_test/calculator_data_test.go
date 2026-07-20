//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// validSKState is a minimal, schema-compliant Skull King calculator document.
// Player ids are filled in per-test.
func validSKState(pA, pB string) map[string]any {
	return map[string]any{
		"schema_version":       1,
		"current_round":        2,
		"current_player_index": 0,
		"players":              []map[string]any{{"player_id": pA, "name": "A"}, {"player_id": pB, "name": "B"}},
		"rounds": [][]map[string]any{
			{{"bid": 0, "actual": 0, "bonus": 0}, {"bid": 1, "actual": 1, "bonus": 10}},
		},
	}
}

// TestAddMatch_PersistsCalculatorData verifies that passing Calculator in
// AddMatchOpts writes the three calculator columns and they survive a re-read.
func TestAddMatch_PersistsCalculatorData(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "CalcA")
	playerB := createTestPlayer(t, pool, "CalcB")
	gameID := createTestGame(t, pool, "Skull King")
	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	data, _ := json.Marshal(validSKState(playerA, playerB))
	created, err := svc.AddMatch(ctx, gameID, map[string]float64{playerA: 10, playerB: 5}, time.Now().Add(-time.Hour), elo.AddMatchOpts{
		ClientDate: true,
		ID:         newID(t),
		Calculator: &elo.CalculatorInput{Kind: "skull-king", Version: 1, Data: data},
	})
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// Read columns back directly via the row query.
	rows, err := db.New(pool).GetMatchWithPlayers(ctx, created.ID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("GetMatchWithPlayers: %v (rows=%d)", err, len(rows))
	}
	if !rows[0].CalculatorKind.Valid || rows[0].CalculatorKind.String != "skull-king" {
		t.Errorf("calculator_kind = %+v, want skull-king", rows[0].CalculatorKind)
	}
	if len(rows[0].CalculatorData) == 0 {
		t.Fatalf("calculator_data empty after write")
	}
	var got map[string]any
	if err := json.Unmarshal(rows[0].CalculatorData, &got); err != nil {
		t.Fatalf("stored data not JSON: %v", err)
	}
	if v, _ := got["current_round"].(float64); int(v) != 2 {
		t.Errorf("current_round = %v, want 2", got["current_round"])
	}
}

// TestAddMatch_InvalidCalculatorDataRejected checks that the DB layer trusts the
// handler for validation; this test just confirms the happy path is wired and
// stores the document as-is. (Schema validation lives in pkg/calculator, which
// has its own unit tests.)
func TestAddMatch_CalculatorDataRoundtrips(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "RTA")
	playerB := createTestPlayer(t, pool, "RTB")
	gameID := createTestGame(t, pool, "IAWW")
	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	doc := map[string]any{
		"schema_version": 2,
		"players":        []map[string]any{{"player_id": playerA, "name": "A"}, {"player_id": playerB, "name": "B"}},
		"direct_vp":      []map[string]any{{"player_id": playerA, "value": 5}},
		"multipliers":    []map[string]any{{"row": "str-res", "player_id": playerA, "coeff": 6, "count": 2}},
	}
	raw, _ := json.Marshal(doc)

	created, err := svc.AddMatch(ctx, gameID, map[string]float64{playerA: 17, playerB: 0}, time.Now().Add(-time.Hour), elo.AddMatchOpts{
		ClientDate: true,
		ID:         newID(t),
		Calculator: &elo.CalculatorInput{Kind: "iaww", Version: 2, Data: raw},
	})
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// Update: replace calculator_data, then clear it.
	updatedDoc := map[string]any{
		"schema_version": 2,
		"players":        []map[string]any{{"player_id": playerA, "name": "A"}, {"player_id": playerB, "name": "B"}},
		"direct_vp":      []map[string]any{{"player_id": playerB, "value": 99}},
		"multipliers":    []map[string]any{},
	}
	updatedRaw, _ := json.Marshal(updatedDoc)
	kind := "iaww"
	if _, err := svc.UpdateMatch(ctx, created.ID, gameID, map[string]float64{playerA: 0, playerB: 17}, created.Date.Time, elo.UpdateMatchOpts{
		Calculator: &elo.CalculatorUpdate{Kind: &kind, Version: 2, Data: updatedRaw},
	}); err != nil {
		t.Fatalf("UpdateMatch replace: %v", err)
	}

	rows, _ := db.New(pool).GetMatchWithPlayers(ctx, created.ID)
	var got map[string]any
	_ = json.Unmarshal(rows[0].CalculatorData, &got)
	dv := got["direct_vp"].([]any)[0].(map[string]any)
	if dv["player_id"] != playerB {
		t.Errorf("after update: expected playerB in direct_vp, got %v", dv["player_id"])
	}

	// Clear.
	if _, err := svc.UpdateMatch(ctx, created.ID, gameID, map[string]float64{playerA: 5, playerB: 5}, created.Date.Time, elo.UpdateMatchOpts{
		Calculator: &elo.CalculatorUpdate{Kind: nil},
	}); err != nil {
		t.Fatalf("UpdateMatch clear: %v", err)
	}
	rows2, _ := db.New(pool).GetMatchWithPlayers(ctx, created.ID)
	if rows2[0].CalculatorKind.Valid {
		t.Errorf("calculator_kind should be NULL after clear, got %q", rows2[0].CalculatorKind.String)
	}
	if len(rows2[0].CalculatorData) != 0 {
		t.Errorf("calculator_data should be empty after clear, got %q", string(rows2[0].CalculatorData))
	}
}

// TestUpdateMatch_LeavesCalculatorUntouchedWhenOptsNil confirms the default
// behaviour: an UpdateMatch without an explicit Calculator update preserves
// the existing calculator columns.
func TestUpdateMatch_LeavesCalculatorUntouchedWhenOptsNil(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "LVA")
	playerB := createTestPlayer(t, pool, "LVB")
	gameID := createTestGame(t, pool, "Both")
	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	data, _ := json.Marshal(validSKState(playerA, playerB))
	created, err := svc.AddMatch(ctx, gameID, map[string]float64{playerA: 10, playerB: 5}, time.Now().Add(-time.Hour), elo.AddMatchOpts{
		ClientDate: true,
		ID:         newID(t),
		Calculator: &elo.CalculatorInput{Kind: "skull-king", Version: 1, Data: data},
	})
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	if _, err := svc.UpdateMatch(ctx, created.ID, gameID, map[string]float64{playerA: 5, playerB: 10}, created.Date.Time, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("UpdateMatch: %v", err)
	}
	rows, _ := db.New(pool).GetMatchWithPlayers(ctx, created.ID)
	if !rows[0].CalculatorKind.Valid || rows[0].CalculatorKind.String != "skull-king" {
		t.Errorf("calculator_kind changed during plain update: %+v", rows[0].CalculatorKind)
	}
}
