//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// planHasRematch reports whether some slot seats two places of one
// previous-round slot — an immediate rematch of tablemates.
func planHasRematch(plan bracketPlanDoc) bool {
	for _, r := range plan.Rounds {
		for _, s := range r.Slots {
			seen := map[int]bool{}
			for _, seat := range s.Seats {
				if seat.SourceSlot == nil {
					continue
				}
				if seen[*seat.SourceSlot] {
					return true
				}
				seen[*seat.SourceSlot] = true
			}
		}
	}
	return false
}

type bracketPlansJSON struct {
	Data struct {
		Plans     []bracketPlanDoc `json:"plans"`
		Truncated bool             `json:"truncated"`
		Cap       int              `json:"cap"`
		Facets    struct {
			Eliminations []string `json:"eliminations"`
			RoundCounts  []int    `json:"round_counts"`
			HasByes      bool     `json:"has_byes"`
			AllByes      bool     `json:"all_byes"`
			FirstShapes  []string `json:"first_shapes"`
			Advances     []int    `json:"advances"`
			HasRematches bool     `json:"has_rematches"`
			AllRematches bool     `json:"all_rematches"`
		} `json:"facets"`
	} `json:"data"`
}

// TestTournament_CRUDAndRegistration drives the registration-time surface:
// idempotent create with pool + initial participants, config PUT (desired
// participant set), the detail/list reads, and the audit trail (create row,
// update row, and nothing for a no-op PUT).
func TestTournament_BracketPlans(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Четвёрки")
	gameID2 := createTestGame(t, pool, "Парные")

	tid := newID(t)
	var ids []string
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Сеточник%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок четвёрок", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}

	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans: %d %s", w.Code, w.Body.String())
	}
	var plans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil {
		t.Fatalf("decode plans: %v", err)
	}
	// Both elimination families are offered side by side; the facets cover them.
	sawSingle, sawDouble := false, false
	for _, p := range plans.Data.Plans {
		switch p.Elimination {
		case "single":
			sawSingle = true
		case "double":
			sawDouble = true
		}
	}
	if !sawSingle || !sawDouble {
		t.Fatalf("8/{{4}} must offer both families, single=%v double=%v of %d plans", sawSingle, sawDouble, len(plans.Data.Plans))
	}
	if len(plans.Data.Facets.Eliminations) != 2 {
		t.Fatalf("facets eliminations: %v", plans.Data.Facets.Eliminations)
	}

	// The elimination chip narrows the list; the flagship single-elim plan
	// (4+4 advance-2 → final 4 advance-1) heads it — longer bye-grinding
	// shapes follow.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=single", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans?elimination=single: %d %s", w.Code, w.Body.String())
	}
	var singlePlans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &singlePlans); err != nil {
		t.Fatalf("decode single plans: %v", err)
	}
	if len(singlePlans.Data.Plans) == 0 || singlePlans.Data.Truncated {
		t.Fatalf("8/{{4}} must offer single plans, got %d truncated=%v", len(singlePlans.Data.Plans), singlePlans.Data.Truncated)
	}
	p := singlePlans.Data.Plans[0]
	if len(p.Rounds) != 2 || p.Rounds[0].Advance != 2 || len(p.Rounds[0].Slots) != 2 || p.Rounds[0].Slots[0].SeatCount != 4 {
		t.Fatalf("flagship plan shape: %+v", p.Rounds)
	}
	if p.Rounds[1].Track != "final" || p.Rounds[1].Slots[0].Seats[0].Kind != "source" {
		t.Fatalf("final round must be source-seated: %+v", p.Rounds[1])
	}
	if got := singlePlans.Data.Facets.Eliminations; len(got) != 1 || got[0] != "single" {
		t.Fatalf("single-family facets: %v", got)
	}
	if !slices.Contains(singlePlans.Data.Facets.Advances, 1) || !slices.Contains(singlePlans.Data.Facets.Advances, 2) {
		t.Fatalf("facets advances: %v", singlePlans.Data.Facets.Advances)
	}
	// On a 4-seat-only pool every plan opens 4+4 advance-2 (advancing one
	// would strand two survivors no game can seat), so every plan seats
	// tablemates of one previous-round slot together — the rematch facets are
	// all-true and the UI hides the chip row.
	if !singlePlans.Data.Facets.HasRematches || !singlePlans.Data.Facets.AllRematches {
		t.Fatalf("facets rematches: has=%v all=%v", singlePlans.Data.Facets.HasRematches, singlePlans.Data.Facets.AllRematches)
	}

	// The advances chip keeps plans whose every non-final round advances the
	// listed count — the flagship 4+4 → 2 plan qualifies for advances=2, and
	// the facets still describe the whole space.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=single&advances=2", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans?advances=2: %d %s", w.Code, w.Body.String())
	}
	var advancePlans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &advancePlans); err != nil {
		t.Fatalf("decode advance-2 plans: %v", err)
	}
	if len(advancePlans.Data.Plans) == 0 {
		t.Fatalf("8/{{4}} must offer advance-2 plans")
	}
	for _, plan := range advancePlans.Data.Plans {
		for _, r := range plan.Rounds[:len(plan.Rounds)-1] {
			if r.Advance != 2 {
				t.Fatalf("advances=2 leaked advance %d: %+v", r.Advance, plan.Rounds)
			}
		}
	}
	if !slices.Contains(advancePlans.Data.Facets.Advances, 1) {
		t.Fatalf("facets must ignore the display filters: %v", advancePlans.Data.Facets.Advances)
	}

	// The rematches=without chip keeps only plans whose every slot takes its
	// players from different previous-round slots — no such plan exists on a
	// 4-seat-only pool, so the list empties while the facets stay.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=single&rematches=without", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans?rematches=without: %d %s", w.Code, w.Body.String())
	}
	var cleanPlans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &cleanPlans); err != nil {
		t.Fatalf("decode rematch-free plans: %v", err)
	}
	if len(cleanPlans.Data.Plans) != 0 {
		t.Fatalf("8/{{4}} has no rematch-free plan, got %d", len(cleanPlans.Data.Plans))
	}
	if !cleanPlans.Data.Facets.HasRematches || !cleanPlans.Data.Facets.AllRematches {
		t.Fatalf("facets must ignore the display filters: %+v", cleanPlans.Data.Facets)
	}
	if !planHasRematch(singlePlans.Data.Plans[0]) {
		t.Fatalf("flagship 4+4 advance-2 plan must seat tablemates together")
	}

	// rematches=with keeps the whole single-elim space.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=single&rematches=with", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans?rematches=with: %d %s", w.Code, w.Body.String())
	}
	var dirtyPlans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &dirtyPlans); err != nil {
		t.Fatalf("decode with-rematches plans: %v", err)
	}
	if len(dirtyPlans.Data.Plans) != len(singlePlans.Data.Plans) {
		t.Fatalf("rematches=with must keep every single-elim plan: %d vs %d",
			len(dirtyPlans.Data.Plans), len(singlePlans.Data.Plans))
	}
	for _, plan := range dirtyPlans.Data.Plans {
		if !planHasRematch(plan) {
			t.Fatalf("rematches=with leaked a rematch-free plan: %+v", plan.Rounds)
		}
	}

	// The double-elim chip keeps only double plans.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=double", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans?elimination=double: %d %s", w.Code, w.Body.String())
	}
	var doublePlans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &doublePlans); err != nil {
		t.Fatalf("decode double plans: %v", err)
	}
	if len(doublePlans.Data.Plans) == 0 {
		t.Fatalf("8/{{4}} must offer double-elim plans")
	}
	for _, dp := range doublePlans.Data.Plans {
		if dp.Elimination != "double" {
			t.Fatalf("double chip leaked a %s plan", dp.Elimination)
		}
	}

	// Too few participants → 400.
	small := newID(t)
	one := createTestPlayer(t, pool, "Один")
	createBody = fmt.Sprintf(`{"id": %q, "name": "Малый кубок", "games": [{"game_id": %q, "min_players": 2, "max_players": 4}], "participant_ids": [%q]}`,
		short(small), short(gameID2), short(one))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create small tournament: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(small)+"/bracket-plans", admin, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("1 participant must 400, got %d", w.Code)
	}

	// Empty pool → 400.
	empty := newID(t)
	createBody = fmt.Sprintf(`{"id": %q, "name": "Без игр"}`, short(empty))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create empty-pool tournament: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(empty)+"/bracket-plans", admin, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty pool must 400, got %d", w.Code)
	}

	// Closed registration → 409.
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET status = 'running' WHERE id = $1`, tid); err != nil {
		t.Fatalf("close registration: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusConflict {
		t.Fatalf("closed registration must 409, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Phase 4: start, materialization, bracket, arena
// ---------------------------------------------------------------------------

type bracketJSON struct {
	Data struct {
		TournamentId   string  `json:"tournament_id"`
		Status         string  `json:"status"`
		Elimination    string  `json:"elimination"`
		WinnerPlayerId *string `json:"winner_player_id"`
		Rounds         []struct {
			Track string `json:"track"`
			Index int    `json:"index"`
			Slots []struct {
				Id       string  `json:"id"`
				GameId   string  `json:"game_id"`
				Position int     `json:"position"`
				Advance  int     `json:"advance"`
				MinScore float64 `json:"min_score"`
				Status   string  `json:"status"`
				Seats    []struct {
					Position     int     `json:"position"`
					PlayerId     *string `json:"player_id"`
					SourceSlotId *string `json:"source_slot_id"`
					SourcePlace  *int    `json:"source_place"`
				} `json:"seats"`
				Matches []struct {
					MatchId string `json:"match_id"`
					Scores  []struct {
						PlayerId string  `json:"player_id"`
						Points   float64 `json:"points"`
					} `json:"scores"`
				} `json:"matches"`
				Standings []struct {
					PlayerId string  `json:"player_id"`
					Points   float64 `json:"points"`
					Place    int     `json:"place"`
					Advanced bool    `json:"advanced"`
				} `json:"standings"`
				Ruling *[]string `json:"ruling_player_ids"`
			} `json:"slots"`
		} `json:"rounds"`
	} `json:"data"`
}

// TestTournament_StartMaterializesBracket drives the start action on the
// flagship 8-player shape: the seeded draw fills both round-1 tables (every
// participant seated exactly once), the final waits on sources, the arena is
// created, and the status flips to running. A hand-forged plan is rejected.
