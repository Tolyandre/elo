//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	mainapi "github.com/tolyandre/elo-web-service/pkg/api"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

const testJWTSecret = "integration-test-jwt-secret"

// setupTestDB starts a postgres container, applies migrations, and returns the pool + cleanup func.
func setupTestDB(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	ctx := context.Background()

	pgContainer, err := tcpostgres.Run(ctx, "docker.io/postgres:16-alpine",
		tcpostgres.WithDatabase("elo_test"),
		tcpostgres.WithUsername("elo_test"),
		tcpostgres.WithPassword("test_secret"),
		tcpostgres.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	if err := db.MigrateUpWithDSN(connStr); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}

	return pool, func() {
		pool.Close()
		if err := pgContainer.Terminate(ctx); err != nil {
			t.Logf("terminate container: %v", err)
		}
	}
}

// setupRouter builds a router identical to main.go for use in httptest requests.
func setupRouter(pool *pgxpool.Pool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	cfg.Config.CookieJwtSecret = testJWTSecret
	cfg.Config.CookieTtlSeconds = 3600
	cfg.Config.FrontendUri = "http://localhost:3000"

	r := gin.New()
	a := mainapi.New(pool)
	o := apioauth2.New(pool)

	r.GET("/ping", a.GetPing)
	r.GET("/players", a.ListPlayers)
	r.POST("/players", o.DeserializeUser(), a.CreatePlayer)
	r.PATCH("/players/:id", o.DeserializeUser(), a.PatchPlayer)
	r.DELETE("/players/:id", o.DeserializeUser(), a.DeletePlayer)
	return r
}

// createTestUser inserts a user row and returns a signed JWT for that user.
func createTestUser(t *testing.T, pool *pgxpool.Pool, allowEditing bool) string {
	t.Helper()
	queries := db.New(pool)
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		AllowEditing:        allowEditing,
		GoogleOauthUserID:   "test-user-001",
		GoogleOauthUserName: "Test User",
	})
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	token, err := apioauth2.CreateJwt(time.Hour, userID, testJWTSecret)
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
	setupRouter(pool).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/players", nil))

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

	// POST /players
	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(`{"name":"Alice"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create player: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// GET /players
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/players", nil))
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
