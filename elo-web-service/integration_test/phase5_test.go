//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// Phase 5 of ADR-36: the tenant's main-arena settings are edited through the
// tenant, the club's membership stint history is readable, bet limits count
// against the market's tenant main arena, and the corrections endpoint is
// gone.

// TestPhase5_TenantArenaSettings pins the main-arena settings editor: PATCH
// /tenants/{id} with a settings document updates the main arena and
// recalculates it in the same transaction; an invalid document is a 400; the
// arena itself stays system-managed (PATCH /arenas/{id} → 409).
func TestPhase5_TenantArenaSettings(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Настройное", "any_member", "open")
	arenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	// A member plays a match so the arena has a settlement to re-derive.
	member := createTestPlayer(t, pool, "Настройщик")
	guest := createBareTestPlayer(t, pool, "Настройщик-гость")
	addClubMember(t, router, token, clubA.String(), member)
	game := createTestGame(t, pool, "Игра настроек")
	if _, err := newMatchService(pool).AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	readStartingRating := func() float64 {
		t.Helper()
		var doc json.RawMessage
		if err := pool.QueryRow(ctx, `SELECT settings FROM arenas WHERE id = $1`, arenaID).Scan(&doc); err != nil {
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

	// Snapshot the arena's ratings before the change; the settings change
	// must re-derive the chain from the new document.
	var beforeMax float64
	if err := pool.QueryRow(ctx, `SELECT coalesce(max(rating_after), 0) FROM arena_settlements WHERE arena_id = $1`, arenaID).Scan(&beforeMax); err != nil {
		t.Fatalf("read settlements: %v", err)
	}

	// Change the settings through the tenant: a new starting rating and an
	// elite league on top.
	w := doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"settings": {"starting_rating": 1234, "leagues": [{"kind": "newbie", "goal_gap": 20, "earned_min": 2, "earned_max": 60, "tau": 90}, {"kind": "elite", "matches_6m": 5, "matches_2m": 2}]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant settings: %d %s", w.Code, w.Body.String())
	}
	if got := readStartingRating(); got != 1234 {
		t.Fatalf("main arena starting rating = %v, want 1234 after the tenant PATCH", got)
	}

	// The settings save only queues the arena (ADR-36 phase 6); the drain —
	// the background worker's job — re-derives the chain from the NEW
	// document.
	drainArenas(t, pool)

	// The recalculation re-derived the arena from the new settings: the
	// stored ratings moved off their pre-change values.
	rows := settlementCount(t, pool, arenaID, nil)
	if rows == 0 {
		t.Fatalf("arena lost its settlements after the settings change")
	}
	var maxRating float64
	if err := pool.QueryRow(ctx, `SELECT max(rating_after) FROM arena_settlements WHERE arena_id = $1`, arenaID).Scan(&maxRating); err != nil {
		t.Fatalf("read settlements: %v", err)
	}
	if maxRating == beforeMax {
		t.Fatalf("ratings did not move (%v), want a re-derivation from the new settings document", maxRating)
	}

	// An invalid settings document is a 400.
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"settings": {"starting_rating": "not-a-number"}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid settings doc gave %d, want 400", w.Code)
	}

	// The arena stays system-managed: a direct arena PATCH is a 409.
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+tenantArena, token,
		`{"name": "Захвачено", "settings": {"starting_rating": 1, "leagues": []}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("direct arena PATCH gave %d, want 409", w.Code)
	}
}

// TestPhase5_ClubMemberHistory pins GET /clubs/{id}/members/history (ADR-36):
// every stint of the club, latest first, with closed stints kept.
func TestPhase5_ClubMemberHistory(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	if w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Исторический"}`, clubID)); w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}

	first := createTestPlayer(t, pool, "Историк-1")
	second := createTestPlayer(t, pool, "Историк-2")
	addClubMember(t, router, token, clubID.String(), first)
	addClubMember(t, router, token, clubID.String(), second)
	// first leaves (the stint closes) and rejoins.
	if w := doJSON(t, router, http.MethodDelete, "/clubs/"+clubID.String()+"/members/"+first.String(), token, ""); w.Code != http.StatusOK {
		t.Fatalf("remove member: %d %s", w.Code, w.Body.String())
	}
	addClubMember(t, router, token, clubID.String(), first)

	w := doJSON(t, router, http.MethodGet, "/clubs/"+clubID.String()+"/members/history", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET history: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			PlayerID   string  `json:"player_id"`
			PlayerName string  `json:"player_name"`
			JoinedAt   string  `json:"joined_at"`
			LeftAt     *string `json:"left_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if len(resp.Data) != 3 {
		t.Fatalf("history holds %d stints, want 3 (second's active, first's closed, first's re-opened)", len(resp.Data))
	}
	if resp.Data[0].PlayerID != short(first) {
		t.Fatalf("latest stint = %s, want the re-joined member %s", resp.Data[0].PlayerID, short(first))
	}
	if resp.Data[0].LeftAt != nil {
		t.Fatalf("the re-joined stint must be active, got left_at = %v", resp.Data[0].LeftAt)
	}
	closed := 0
	for _, s := range resp.Data {
		if s.LeftAt != nil {
			closed++
		}
	}
	if closed != 1 {
		t.Fatalf("history holds %d closed stints, want 1", closed)
	}
}

// TestPhase5_BetLimitFollowsTenantArena pins the bet-limit basis (ADR-36
// phase 5): the limit derives from the player's latest elo in the market's
// tenant main arena at read time — a bigger elo in that arena buys headroom,
// and elo settled in another tenant's arena does not.
func TestPhase5_BetLimitFollowsTenantArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)
	// any_member: outsiders pass the membership gate so the assertions hit the
	// bet limit, not the members-only 403.
	tenantID, clubA, _ := createTenant(t, router, admin, "Ставочное", "any_member", "open")

	member := createTestPlayer(t, pool, "Ставочник")
	outsider := createBareTestPlayer(t, pool, "Ставочник-гость")
	addClubMember(t, router, admin, clubA.String(), member)

	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		TenantID:   tenantID,
		MarketType: "match_winner",
		StartsAt:   time.Now(),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  createTestAdmin(t, pool),
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{member, outsider},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// With the default settings (K=32) a player who never played in the
	// arena sits at the starting elo — limit 16, so a guarantee of risk 20
	// is beyond it.
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, outsider, 20, 0); !errors.Is(err, elo.ErrBetLimitExceeded) {
		t.Fatalf("fresh outsider guarantee of 20: %v, want ErrBetLimitExceeded", err)
	}

	// A big elo in ANOTHER tenant's arena does not transfer: even with the
	// outsider's «Синие люди» elo lifted, the fresh-tenant limit stays 16.
	setBetLimit(t, pool, blueMenTenantID, outsider, 24)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, outsider, 20, 0); !errors.Is(err, elo.ErrBetLimitExceeded) {
		t.Fatalf("outsider guarantee after foreign-arena elo: %v, want ErrBetLimitExceeded", err)
	}

	// The member's own arena elo is the basis: seeded to limit 24 in this
	// tenant's main arena, the risk-20 guarantee goes through.
	setBetLimit(t, pool, tenantID, member, 24)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, member, 20, 0); err != nil {
		t.Fatalf("member guarantee of 20 after own-arena elo: %v", err)
	}
}
