//go:build integration

package integration_test

// Shared test harness and cross-file helpers for the integration suite.
//
// TestMain starts ONE postgres container for the whole package run and applies
// migrations once into a template database. Every test then clones that
// template (CREATE DATABASE ... TEMPLATE), giving each test the exact
// fresh-migration state — seeds included — that the previous per-test
// containers provided, at file-copy speed (~200s → ~30s for the suite).
// Tests must NOT use t.Parallel — they run sequentially by design.

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	mainapi "github.com/tolyandre/elo-web-service/pkg/api"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

const testJWTSecret = "integration-test-jwt-secret"

const (
	templateDB    = "elo_test_template"
	containerDB   = "elo_test"
	maintenanceDB = "postgres"
)

var (
	maintenancePool *pgxpool.Pool // connected to the maintenance DB, clones test databases
	templateURL     *url.URL      // base URL of the template database
	dbCounter       atomic.Int64  // unique per-test database names
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	pgContainer, err := tcpostgres.Run(ctx, "docker.io/postgres:16-alpine",
		tcpostgres.WithDatabase(containerDB),
		tcpostgres.WithUsername("elo_test"),
		tcpostgres.WithPassword("test_secret"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start postgres container: %v\n", err)
		os.Exit(1)
	}

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "get connection string: %v\n", err)
		os.Exit(1)
	}
	if err := db.MigrateUpWithDSN(connStr); err != nil {
		fmt.Fprintf(os.Stderr, "apply migrations: %v\n", err)
		os.Exit(1)
	}

	// Turn the migrated database into the template every test clones. The
	// migrate instance leaves a backend connected, so terminate those first.
	u, err := url.Parse(connStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse connection string: %v\n", err)
		os.Exit(1)
	}
	u.Path = "/" + maintenanceDB
	maintenancePool, err = pgxpool.New(ctx, u.String())
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect maintenance db: %v\n", err)
		os.Exit(1)
	}
	if _, err := maintenancePool.Exec(ctx,
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
		containerDB,
	); err != nil {
		fmt.Fprintf(os.Stderr, "terminate template backends: %v\n", err)
		os.Exit(1)
	}
	if _, err := maintenancePool.Exec(ctx, fmt.Sprintf(`ALTER DATABASE %s RENAME TO %s`, containerDB, templateDB)); err != nil {
		fmt.Fprintf(os.Stderr, "rename template database: %v\n", err)
		os.Exit(1)
	}
	u.Path = "/" + templateDB
	templateURL = u

	code := m.Run()

	maintenancePool.Close()
	if err := pgContainer.Terminate(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "terminate container: %v\n", err)
	}
	os.Exit(code)
}

// setupTestDB returns a pool connected to a fresh clone of the migrated
// template database. The cleanup func drops the clone; tests keep
// `defer cleanup()`.
func setupTestDB(t *testing.T) (*pgxpool.Pool, func()) {
	t.Helper()
	pool, _, cleanup := setupTestDBWithDSN(t)
	return pool, cleanup
}

// setupTestDBWithDSN is like setupTestDB but also returns the connection string,
// so tests can exercise the in-process data-migration runner (MigrateCalculatorData),
// which opens its own pool from the DSN.
func setupTestDBWithDSN(t *testing.T) (*pgxpool.Pool, string, func()) {
	t.Helper()
	name := fmt.Sprintf("elo_test_%d", dbCounter.Add(1))
	if _, err := maintenancePool.Exec(context.Background(),
		fmt.Sprintf(`CREATE DATABASE %s TEMPLATE %s`, name, templateDB),
	); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	u := *templateURL
	u.Path = "/" + name
	dsn := u.String()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	return pool, dsn, func() {
		pool.Close()
		if _, err := maintenancePool.Exec(context.Background(),
			fmt.Sprintf(`DROP DATABASE %s WITH (FORCE)`, name),
		); err != nil {
			t.Logf("drop test database: %v", err)
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

	strictWrapper := &mainapi.ServerInterfaceWrapper{
		Handler: mainapi.NewStrictHandler(mainapi.NewStrictServer(a, o), nil),
	}

	r.GET("/ping", strictWrapper.GetPing)
	r.GET("/players", strictWrapper.ListPlayers)
	r.GET("/players/:id/stats", strictWrapper.GetPlayerStats)
	r.POST("/players", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreatePlayer)
	r.PATCH("/players/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchPlayer)
	r.DELETE("/players/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeletePlayer)
	// Matches: needed by the calculator-data idcodec roundtrip test and any
	// future match-level integration test.
	r.GET("/matches", strictWrapper.ListMatches)
	r.GET("/matches/:id", strictWrapper.GetMatchById)
	r.POST("/matches", o.DeserializeUser(), a.RequireEditor(), strictWrapper.AddMatch)
	r.GET("/matches/:id/markets", strictWrapper.GetMarketsByMatchId)
	r.PUT("/matches/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.UpdateMatch)
	// Games and clubs: needed by the audit-log integration test (ADR-14).
	r.POST("/games", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateGame)
	r.PATCH("/games/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchGame)
	r.DELETE("/games/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeleteGame)
	r.POST("/clubs", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateClub)
	r.PATCH("/clubs/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchClub)
	r.DELETE("/clubs/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeleteClub)
	r.GET("/audit", strictWrapper.ListAuditEvents)
	// Auth /me: raw gin handlers on the oauth2 handler, mirroring main.go.
	r.GET("/auth/me", o.DeserializeUser(), o.GetMe)
	r.PATCH("/auth/me", o.DeserializeUser(), o.PatchMe)
	// Markets: needed by the outcome-id idcodec roundtrip test (bet placement
	// and the resolved-market outcome id).
	r.GET("/markets", strictWrapper.ListMarkets)
	r.POST("/markets", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateMarket)
	r.GET("/markets/:id", strictWrapper.GetMarket)
	r.GET("/markets/:id/probability-history", strictWrapper.GetMarketProbabilityHistory)
	r.POST("/markets/:id/bets", o.DeserializeUser(), strictWrapper.PlaceBet)
	r.POST("/markets/:id/guarantees", o.DeserializeUser(), strictWrapper.CreateMarketGuarantee)
	// Realtime SSE (ADR-13): the multiplexed global-topics stream; auth is
	// optional (anonymous callers silently get no "me" topic).
	r.GET("/events", o.OptionalDeserializeUser(), a.Events)
	// Live game tables (ADR-13, ADR-15, ADR-16): raw gin handlers mirroring the
	// route group in main.go.
	noStore := func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
	tblPlayerAuth := []gin.HandlerFunc{o.DeserializeUser(), a.RequirePlayerID()}
	tbl := r.Group("/tables", noStore)
	tbl.GET("", a.ListTables)
	tbl.POST("", append(tblPlayerAuth, a.CreateTable)...)
	tbl.GET("/:id", a.GetTable)
	tbl.PATCH("/:id/state", append(tblPlayerAuth, a.UpdateTableState)...)
	tbl.POST("/:id/join", append(tblPlayerAuth, a.JoinTable)...)
	tbl.POST("/:id/submit", append(tblPlayerAuth, a.SubmitTable)...)
	tbl.POST("/:id/takeover", o.DeserializeUser(), a.TakeoverTable)
	tbl.DELETE("/:id", append(tblPlayerAuth, a.DeleteTable)...)
	tbl.GET("/:id/events", a.TableEvents)
	return r
}

// newID generates a fresh UUIDv7 id for use as a primary key / idempotency key.
func newID(t *testing.T) idpkg.ID {
	t.Helper()
	u, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate uuid: %v", err)
	}
	return idpkg.ID(u.String())
}

// joinGuarantee adds a zero-fee guarantor wager of the market's full L —
// reproducing the pre-ADR-20 default liquidity b = L/ln(n). The player's bet
// limit must cover the risk (guarantor exposure is reserved since ADR-20).
func joinGuarantee(ctx context.Context, t *testing.T, svc elo.IMarketService, marketID, playerID idpkg.ID) {
	t.Helper()
	if _, err := svc.JoinAsGuarantee(ctx, newID(t), marketID, playerID, 16, 0); err != nil {
		t.Fatalf("JoinAsGuarantee(%s): %v", playerID, err)
	}
}

// setBetLimit overrides a player's bet limit directly (tests use it to fund
// guarantor risk; recalculation may rewrite it from the elo formula later).
func setBetLimit(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID, limit float64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE players SET bet_limit = $2 WHERE id = $1`, playerID, limit); err != nil {
		t.Fatalf("set bet limit for %s: %v", playerID, err)
	}
}

// marketOutcomeID returns the market's outcome row id of the given kind — the
// identifier bets and resolution reference. For kind "player" the target
// player's outcome is returned.
func marketOutcomeID(t *testing.T, ctx context.Context, svc *elo.MarketService, marketID idpkg.ID, kind string, playerID idpkg.ID) idpkg.ID {
	t.Helper()
	outcomes, err := svc.Queries.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	for _, o := range outcomes {
		if o.Kind != kind {
			continue
		}
		if kind == "player" {
			if o.PlayerID != nil && *o.PlayerID == playerID {
				return o.ID
			}
			continue
		}
		return o.ID
	}
	t.Fatalf("no %q outcome (player %q) on market %s", kind, playerID, marketID)
	return ""
}

// placeBetAtCurrentPrice places a bet on the given outcome id, passing the
// market's live probability of that outcome as expectedProbability — mirroring
// what the UI sends for the probability it displays. The PlaceBetOutcome is
// returned so callers can assert the charged cost.
func placeBetAtCurrentPrice(ctx context.Context, t *testing.T, svc *elo.MarketService, marketID idpkg.ID, playerID idpkg.ID, outcomeID idpkg.ID, shares float64) (elo.PlaceBetOutcome, error) {
	t.Helper()
	price := liveProbability(t, ctx, svc, marketID, outcomeID)
	return svc.PlaceBet(ctx, newID(t), marketID, playerID, outcomeID, shares, price)
}

// liveProbability returns the outcome's current LMSR probability.
func liveProbability(t *testing.T, ctx context.Context, svc *elo.MarketService, marketID, outcomeID idpkg.ID) float64 {
	t.Helper()
	m, err := svc.Queries.GetMarket(ctx, marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := svc.Queries.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	q := make([]float64, len(outcomes))
	for i, o := range outcomes {
		q[i] = o.Q
	}
	price := -1.0
	for i, o := range outcomes {
		if o.ID == outcomeID {
			price = elo.MarginalProbabilitiesN(q, m.LiquidityB)[i]
		}
	}
	if price < 0 {
		t.Fatalf("outcome %s not found on market %s", outcomeID, marketID)
	}
	return price
}

// liveProbabilities returns the market's current per-outcome probabilities.
func liveProbabilities(t *testing.T, svc *elo.MarketService, marketID idpkg.ID) map[idpkg.ID]float64 {
	t.Helper()
	m, err := svc.Queries.GetMarket(context.Background(), marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := svc.Queries.ListMarketOutcomesWithPools(context.Background(), marketID)
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

func approxEqRel(a, b, rel float64) bool {
	return math.Abs(a-b) <= rel*math.Max(math.Abs(a), math.Abs(b))
}

// newMatchOpts returns AddMatchOpts pre-filled with a fresh client-generated
// match id (ULID). Required since migration 036 made matches.id a UUID with no
// default; the domain service no longer auto-assigns one. Callers can still
// layer on extra fields (TournamentIDs, Calculator, …) via a spread:
//
//	opts := newMatchOpts(t); opts.TournamentIDs = []string{tour.ID}
//
// or pass overrides inline:
//
//	newMatchOpts(t) // plain
func newMatchOpts(t *testing.T) elo.AddMatchOpts {
	t.Helper()
	return elo.AddMatchOpts{ID: newID(t)}
}

// createTestPlayer inserts a player and returns its ID.
func createTestPlayer(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	p, err := q.CreatePlayer(context.Background(), db.CreatePlayerParams{ID: id, Name: name})
	if err != nil {
		t.Fatalf("create player %q: %v", name, err)
	}
	return p.ID
}

// createTestGame inserts a game and returns its ID.
func createTestGame(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	g, err := q.AddGame(context.Background(), db.AddGameParams{ID: id, Name: name})
	if err != nil {
		t.Fatalf("create game %q: %v", name, err)
	}
	return g.ID
}

// createTestAdmin inserts a user with allow_editing=true and returns its ID.
func createTestAdmin(t *testing.T, pool *pgxpool.Pool) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	uid, err := q.CreateUser(context.Background(), db.CreateUserParams{
		ID:                  id,
		AllowEditing:        true,
		GoogleOauthUserID:   fmt.Sprintf("admin-%d", time.Now().UnixNano()),
		GoogleOauthUserName: "Admin",
	})
	if err != nil {
		t.Fatalf("create admin user: %v", err)
	}
	return uid
}

// createTestUserWithID is createTestUser that also returns the user id (market
// and table tests need it to link a player to the acting user).
func createTestUserWithID(t *testing.T, pool *pgxpool.Pool, allowEditing bool) (token string, userID string) {
	t.Helper()
	queries := db.New(pool)
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	userID = uid.String()
	if _, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		ID:                  idpkg.ID(userID),
		AllowEditing:        allowEditing,
		GoogleOauthUserID:   "test-user-with-id-" + userID,
		GoogleOauthUserName: "Test User With ID",
	}); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	token, err = apioauth2.CreateJwt(time.Hour, userID, testJWTSecret)
	if err != nil {
		t.Fatalf("create JWT: %v", err)
	}
	return token, userID
}

// shortOf encodes a canonical uuid to the short Base58 form the API boundary
// uses (same codec as the idcodec middleware).
func shortOf(t *testing.T, canonical idpkg.ID) string {
	t.Helper()
	return string(canonical.Base58())
}

// playerRatingRows returns all global_arena_settlement rows for a player, ordered by date.
func playerRatingRows(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) []db.RatingHistoryRow {
	t.Helper()
	rows, err := db.New(pool).RatingHistory(context.Background(), playerID)
	if err != nil {
		t.Fatalf("rating history for player %s: %v", playerID, err)
	}
	return rows
}

// latestRating returns the most recent new_rating (display track) for a player.
func latestRating(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) float64 {
	t.Helper()
	rows := playerRatingRows(t, pool, playerID)
	if len(rows) == 0 {
		t.Fatalf("no rating rows for player %s", playerID)
	}
	return rows[len(rows)-1].Rating
}

// latestElo returns the most recent new_elo (true Elo, zero-sum) for a player.
func latestElo(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) float64 {
	t.Helper()
	var elo float64
	err := pool.QueryRow(context.Background(),
		`SELECT elo_after FROM global_arena_settlement WHERE player_id = $1 ORDER BY date DESC, id DESC LIMIT 1`,
		playerID,
	).Scan(&elo)
	if err != nil {
		t.Fatalf("latestElo for player %s: %v", playerID, err)
	}
	return elo
}

// marketSettlementRatingCount returns how many global_arena_settlement rows exist for a player with discriminator='market'.
func marketSettlementRatingCount(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) int {
	t.Helper()
	var count int
	err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM global_arena_settlement WHERE player_id = $1 AND discriminator = 'market'`,
		playerID,
	).Scan(&count)
	if err != nil {
		t.Fatalf("count market_settlement ratings for player %s: %v", playerID, err)
	}
	return count
}

// readBetShares returns the shares stored on a player's (single) buy.
func readBetShares(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID, playerID idpkg.ID) float64 {
	t.Helper()
	var shares float64
	err := pool.QueryRow(context.Background(),
		`SELECT shares FROM bets WHERE market_id = $1 AND player_id = $2 LIMIT 1`, marketID, playerID,
	).Scan(&shares)
	if err != nil {
		t.Fatalf("read shares for %s: %v", playerID, err)
	}
	return shares
}

// readBetCost returns the AMM-priced elo cost stored on a player's (single) buy.
func readBetCost(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID, playerID idpkg.ID) float64 {
	t.Helper()
	var cost float64
	err := pool.QueryRow(context.Background(),
		`SELECT cost FROM bets WHERE market_id = $1 AND player_id = $2 LIMIT 1`, marketID, playerID,
	).Scan(&cost)
	if err != nil {
		t.Fatalf("read cost for %s: %v", playerID, err)
	}
	return cost
}

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

// playerMarketEarned returns elo_earned for a player's market settlement row (0 if none).
func playerMarketEarned(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID, playerID idpkg.ID) float64 {
	t.Helper()
	var earned float64
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(elo_earned), 0) FROM global_arena_settlement WHERE market_id = $1 AND player_id = $2`,
		marketID, playerID,
	).Scan(&earned)
	if err != nil {
		t.Fatalf("market earned for %s: %v", playerID, err)
	}
	return earned
}

// playerMarketDelta returns elo_staked + elo_earned for a player's market settlement row,
// or 0 if no such row exists.
func playerMarketDelta(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID, playerID idpkg.ID) float64 {
	t.Helper()
	var delta float64
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(elo_staked + elo_earned), 0) FROM global_arena_settlement WHERE market_id = $1 AND player_id = $2`,
		marketID, playerID,
	).Scan(&delta)
	if err != nil {
		t.Fatalf("market delta for %s: %v", playerID, err)
	}
	return delta
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
