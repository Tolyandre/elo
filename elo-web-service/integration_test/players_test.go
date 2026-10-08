//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// createTestUser inserts a user row and returns a signed JWT for that user.

// createTestUser inserts a user row and returns a signed JWT for that user.
func createTestUser(t *testing.T, pool *pgxpool.Pool, allowEditing bool) string {
	t.Helper()
	queries := db.New(pool)
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		ID:                  idpkg.ID(uid.String()),
		AllowEditing:        allowEditing,
		GoogleOauthUserID:   "test-user-001",
		GoogleOauthUserName: "Test User",
	})
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	token, err := apioauth2.CreateJwt(time.Hour, string(userID), testJWTSecret)
	if err != nil {
		t.Fatalf("create JWT: %v", err)
	}
	return token
}

// TestGetPing checks that /ping works without authentication.
func TestGetPing(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	w := httptest.NewRecorder()
	setupRouter(pool).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ping", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestListPlayers_EmptyOnFreshDB checks that a fresh DB returns an empty player list.
func TestListPlayers_EmptyOnFreshDB(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	w := httptest.NewRecorder()
	setupRouter(pool).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/players?tenant="+blueMenTenantUUID, nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Data) != 0 {
		t.Errorf("expected empty players list, got %d items", len(resp.Data))
	}
}

// TestListPlayers_WithoutTenantIsCatalogOnly pins the tenant-optional read
// (ADR-36 phase 7): without ?tenant= the global catalog loads — names resolve
// on pages opened by a direct link — but the ranking columns are absent;
// with a tenant they come back.
func TestListPlayers_WithoutTenantIsCatalogOnly(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	player := createTestPlayer(t, pool, "Каталог")
	router := setupRouter(pool)

	withoutTenant := func() []map[string]any {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/players", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("GET /players: %d %s", w.Code, w.Body.String())
		}
		var resp struct {
			Data []map[string]any `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode players: %v", err)
		}
		return resp.Data
	}

	list := withoutTenant()
	if len(list) != 1 || list[0]["name"] != "Каталог" {
		t.Fatalf("catalog = %v, want the one player by name", list)
	}
	if _, hasRank := list[0]["rank"]; hasRank {
		t.Fatalf("tenantless catalog carries rank columns: %v", list[0])
	}

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/players?tenant="+blueMenTenantUUID, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /players?tenant=: %d %s", w.Code, w.Body.String())
	}
	var scoped struct {
		Data []struct {
			ID   string          `json:"id"`
			Rank *map[string]any `json:"rank"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&scoped); err != nil {
		t.Fatalf("decode scoped players: %v", err)
	}
	if len(scoped.Data) != 1 || scoped.Data[0].ID != short(player) || scoped.Data[0].Rank == nil {
		t.Fatalf("scoped list = %+v, want the player with rank columns", scoped.Data)
	}
}

// TestCreatePlayer_RequiresAuth checks that POST /players without a token returns 401.
func TestCreatePlayer_RequiresAuth(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(`{"name":"Alice"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	setupRouter(pool).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateAndListPlayer is an end-to-end test: creates a player with a valid JWT and
// verifies it appears in the subsequent listing.
func TestCreateAndListPlayer(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true /* allow_editing */)
	router := setupRouter(pool)

	// POST /players — include client-generated ULID (UUIDv7) as the id/idempotency key.
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate player id: %v", err)
	}
	body := `{"id":"` + uid.String() + `","name":"Alice"}`
	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create player: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// GET /players
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/players?tenant="+blueMenTenantUUID, nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("list players: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp struct {
		Data []struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w2.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Data) != 1 || resp.Data[0].Name != "Alice" {
		t.Errorf("expected [{Alice}], got %+v", resp.Data)
	}
}

// playerStatsJSON is the GET /players/{id}/stats payload (the fields the
// tenant-scoping assertions touch).
type playerStatsJSON struct {
	Data struct {
		PlayerName    string `json:"player_name"`
		RatingHistory []struct {
			Date   string  `json:"date"`
			Rating float64 `json:"rating"`
			Elo    float64 `json:"elo"`
		} `json:"rating_history"`
		TopGamesByMatches []struct {
			GameID       string `json:"game_id"`
			MatchesCount int    `json:"matches_count"`
		} `json:"top_games_by_matches"`
		TopGamesByEloEarned []struct {
			GameID    string  `json:"game_id"`
			EloEarned float64 `json:"elo_earned"`
		} `json:"top_games_by_elo_earned"`
	} `json:"data"`
}

func getPlayerStats(t *testing.T, router http.Handler, path string) (int, *playerStatsJSON) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, path, "", "")
	if w.Code != http.StatusOK {
		return w.Code, nil
	}
	var resp playerStatsJSON
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode player stats: %v", err)
	}
	return w.Code, &resp
}

// TestPlayerStats_TenantScoped pins GET /players/{id}/stats?tenant= (ADR-36):
// the rating history and the Elo-per-game tables read the tenant's
// main arena; "Частые игры" is tenant-independent and counts matches that
// settle into no arena at all; a missing tenant is a 404; since phase 5 the
// parameter is required — reads are tenant-scoped, there is no global default.
func TestPlayerStats_TenantScoped(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Статистическое", "any_member", "open")

	member := createTestPlayer(t, pool, "Статист-член")
	guest := createBareTestPlayer(t, pool, "Статист-гость")
	addClubMember(t, router, token, clubA.String(), member)

	game := createTestGame(t, pool, "Игра статистики")
	otherGame := createTestGame(t, pool, "Другая игра статистики")
	svc := newMatchService(pool)

	// member+guest: created under its owning tenant (ADR-36 phase 7); it
	// settles into that tenant's main arena (any_member) and into the anchor
	// arena too («Синие люди» is all).
	if _, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch member+guest: %v", err)
	}
	// A guest-only match is unrepresentable under either tenant: the create
	// guard demands a current member of the creating tenant.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, otherGame, map[idpkg.ID]float64{guest: 50, createBareTestPlayer(t, pool, "Статист-второй"): 30}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch guests under BlueMen: err = %v, want ErrMatchOutsideTenant", err)
	}
	if _, err := svc.AddMatch(ctx, tenantID, otherGame, map[idpkg.ID]float64{guest: 50, createBareTestPlayer(t, pool, "Статист-третий"): 30}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch guests under the tenant: err = %v, want ErrMatchOutsideTenant", err)
	}

	// The members_only tenant: the strict rule rejects a guest-carrying
	// roster at the source, and a match of its member with a guest can only
	// exist as a recording under another community (here «Синие люди», whose
	// mode is all). Such a historical match settles nothing in the
	// members_only arena, yet «Частые игры» still counts it
	// (tenant-independent).
	closedID, closedClub, closedArena := createTenant(t, router, token, "Закрытое статистическое", "members_only", "open")
	closedArenaID, err := idpkg.ParseTolerant(closedArena)
	if err != nil {
		t.Fatalf("parse closed arena id: %v", err)
	}
	closedMember := createTestPlayer(t, pool, "Закрытый член")
	addClubMember(t, router, token, closedClub.String(), closedMember)
	if _, err := svc.AddMatch(ctx, closedID, otherGame, map[idpkg.ID]float64{closedMember: 50, guest: 30}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchMembersOnly) {
		t.Fatalf("AddMatch closed member+guest under the members_only tenant: err = %v, want ErrMatchMembersOnly", err)
	}
	if _, err := svc.AddMatch(ctx, blueMenTenantID, otherGame, map[idpkg.ID]float64{closedMember: 50, guest: 30}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch closed member+guest under BlueMen: %v", err)
	}
	if got := settlementCount(t, pool, closedArenaID, nil); got != 0 {
		t.Fatalf("members_only arena settled %d rows for a guest match, want 0", got)
	}

	// The guest's tenant-scoped profile: one main-arena rating point (the
	// mixed match), the Elo table from the main arena's only game, and BOTH
	// games in "Частые игры" — the second settled into no arena.
	code, guestStats := getPlayerStats(t, router,
		"/players/"+guest.String()+"/stats?tenant="+tenantID.String())
	if code != http.StatusOK {
		t.Fatalf("guest stats: %d", code)
	}
	if len(guestStats.Data.RatingHistory) != 1 {
		t.Fatalf("guest rating history = %d points, want the one main-arena settlement", len(guestStats.Data.RatingHistory))
	}
	if len(guestStats.Data.TopGamesByEloEarned) != 1 || guestStats.Data.TopGamesByEloEarned[0].GameID != short(game) {
		t.Fatalf("guest elo games = %+v, want only the main-arena game", guestStats.Data.TopGamesByEloEarned)
	}
	if len(guestStats.Data.TopGamesByMatches) != 2 {
		t.Fatalf("guest frequent games = %+v, want both games regardless of settlement", guestStats.Data.TopGamesByMatches)
	}

	// A missing tenant is a 404; garbage is too (unparsable id); since phase 5
	// the parameter-less call is a 400 — reads are tenant-scoped.
	if code := decodeFeedStatus(t, router, "/players/"+guest.String()+"/stats?tenant="+newID(t).String()); code != http.StatusNotFound {
		t.Fatalf("unknown tenant stats gave %d, want 404", code)
	}
	if code := decodeFeedStatus(t, router, "/players/"+guest.String()+"/stats?tenant=garbage"); code != http.StatusNotFound {
		t.Fatalf("garbage tenant stats gave %d, want 404", code)
	}
	if code := decodeFeedStatus(t, router, "/players/"+guest.String()+"/stats"); code != http.StatusBadRequest {
		t.Fatalf("stats without tenant gave %d, want 400", code)
	}

	// The «Синие люди» main arena (the converted global arena) is just another
	// tenant scope now. The member carries a «Синие люди» stint (the
	// pre-tenancy reality), so the mixed match settled there too — one point.
	code, blueStats := getPlayerStats(t, router,
		"/players/"+member.String()+"/stats?tenant="+blueMenTenantUUID)
	if code != http.StatusOK {
		t.Fatalf("member «Синие люди» stats: %d", code)
	}
	if len(blueStats.Data.RatingHistory) != 1 {
		t.Fatalf("member «Синие люди» rating history = %d points, want the «Синие люди» settlement", len(blueStats.Data.RatingHistory))
	}
	code, tenantStats := getPlayerStats(t, router,
		"/players/"+member.String()+"/stats?tenant="+tenantID.String())
	if code != http.StatusOK {
		t.Fatalf("member tenant stats: %d", code)
	}
	if len(tenantStats.Data.RatingHistory) != 1 {
		t.Fatalf("member tenant rating history = %d points, want the main-arena settlement", len(tenantStats.Data.RatingHistory))
	}

	// An outsiders-only match is unrepresentable since the create guard
	// (ADR-36 phase 7): under either tenant nobody in it is a member.
	outsider := createBareTestPlayer(t, pool, "Статист-посторонний")
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{outsider: 40, createBareTestPlayer(t, pool, "Статист-пятый"): 10}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch outsiders under BlueMen: err = %v, want ErrMatchOutsideTenant", err)
	}
	if _, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{outsider: 40, createBareTestPlayer(t, pool, "Статист-четвёртый"): 10}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch outsiders under the tenant: err = %v, want ErrMatchOutsideTenant", err)
	}
	// A player with no matches at all shows an empty profile in every scope.
	code, outsiderBlue := getPlayerStats(t, router,
		"/players/"+outsider.String()+"/stats?tenant="+blueMenTenantUUID)
	if code != http.StatusOK {
		t.Fatalf("outsider «Синие люди» stats: %d", code)
	}
	if len(outsiderBlue.Data.RatingHistory) != 0 {
		t.Fatalf("outsider «Синие люди» rating history = %d points, want none", len(outsiderBlue.Data.RatingHistory))
	}
	code, outsiderTenant := getPlayerStats(t, router,
		"/players/"+outsider.String()+"/stats?tenant="+tenantID.String())
	if code != http.StatusOK {
		t.Fatalf("outsider tenant stats: %d", code)
	}
	if len(outsiderTenant.Data.RatingHistory) != 0 {
		t.Fatalf("outsider tenant rating history = %d points, want none", len(outsiderTenant.Data.RatingHistory))
	}
	if len(outsiderTenant.Data.TopGamesByMatches) != 0 {
		t.Fatalf("outsider frequent games = %+v, want none", outsiderTenant.Data.TopGamesByMatches)
	}

	// The tenant's main arena is the one the ?tenant= resolves to (sanity
	// check the fixture itself).
	_, tenant := getTenant(t, router, tenantID.String())
	if tenant.MainArenaId != tenantArena {
		t.Fatalf("fixture main arena %s != created %s", tenant.MainArenaId, tenantArena)
	}
}
