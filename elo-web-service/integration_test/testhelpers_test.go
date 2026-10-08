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
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
	mainapi "github.com/tolyandre/elo-web-service/pkg/api"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	"github.com/tolyandre/elo-web-service/pkg/bgg"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/tesera"
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

	// Mirror production boot (ADR-36 phase 6): a migration that rewrites a
	// main arena's settlement history marks it stale, and the API process
	// drains every stale arena in full before serving — the background worker
	// would wait out its debounce.
	{
		bootPool, err := pgxpool.New(ctx, connStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "connect for boot replay: %v\n", err)
			os.Exit(1)
		}
		arenaSvc := elo.NewArenaService(bootPool, elo.NewHub())
		marketSvc := elo.NewMarketService(bootPool)
		tournamentSvc := elo.NewTournamentService(bootPool, arenaSvc, marketSvc)
		matchSvc := elo.NewMatchService(bootPool, marketSvc, arenaSvc, tournamentSvc)
		arenaSvc.Sweep = matchSvc
		if err := arenaSvc.ReplayStaleArenas(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "boot replay of stale arenas: %v\n", err)
			os.Exit(1)
		}
		bootPool.Close()
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
	return setupRouterWithTesera(pool, "")
}

// setupRouterWithTesera points the game-suggestion integration at a stub
// server (empty = the real default Tesera URL; tests that don't touch the
// suggestion endpoints never reach it).
func setupRouterWithTesera(pool *pgxpool.Pool, teseraBaseURL string) *gin.Engine {
	return setupRouterWithClients(pool, teseraBaseURL, "")
}

// setupRouterWithClients additionally points the BGG image-enrichment
// integration at a stub server (empty = disabled, like the tests that don't
// touch the enrich endpoint).
func setupRouterWithClients(pool *pgxpool.Pool, teseraBaseURL, bggBaseURL string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	cfg.Config.CookieJwtSecret = testJWTSecret
	cfg.Config.CookieTtlSeconds = 3600
	cfg.Config.FrontendUri = "http://localhost:3000"

	r := gin.New()
	var bggClient *bgg.Client
	if bggBaseURL != "" {
		bggClient = bgg.NewClient(bggBaseURL, "test-token")
	}
	a := mainapi.NewWithClients(pool, tesera.NewClient(teseraBaseURL), bggClient)
	o := apioauth2.New(pool)

	strictWrapper := &mainapi.ServerInterfaceWrapper{
		Handler: mainapi.NewStrictHandler(mainapi.NewStrictServer(a, o), nil),
		// Binding failures (a missing required query parameter) answer as 400s
		// instead of panicking on a nil handler.
		ErrorHandler: func(c *gin.Context, err error, status int) {
			c.JSON(status, gin.H{"status": "fail", "message": err.Error()})
		},
	}

	r.GET("/ping", strictWrapper.GetPing)
	r.GET("/players", strictWrapper.ListPlayers)
	r.GET("/players/recent", o.DeserializeUser(), strictWrapper.ListRecentPlayers)
	r.GET("/players/:id/stats", strictWrapper.GetPlayerStats)
	r.POST("/players", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreatePlayer)
	r.PATCH("/players/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchPlayer)
	r.DELETE("/players/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeletePlayer)
	// Matches: needed by the calculator-data idcodec roundtrip test and any
	// future match-level integration test. Creation is tenant-scoped
	// (ADR-36 phase 7).
	r.GET("/matches", strictWrapper.ListMatches)
	r.GET("/matches/:id", strictWrapper.GetMatchById)
	r.POST("/tenants/:id/matches", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateTenantMatch)
	r.GET("/matches/:id/markets", strictWrapper.GetMarketsByMatchId)
	r.PUT("/matches/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.UpdateMatch)
	// Games and clubs: needed by the audit-log integration test (ADR-14).
	r.GET("/games", strictWrapper.ListGames)
	r.GET("/games/favorites", o.DeserializeUser(), strictWrapper.ListFavoriteGames)
	r.GET("/games/suggestions", o.DeserializeUser(), a.RequireEditor(), strictWrapper.SuggestGames)
	r.POST("/games/auto-match", o.DeserializeUser(), a.RequireEditor(), strictWrapper.AutoMatchGames)
	r.POST("/games/bgg-enrich", o.DeserializeUser(), a.RequireEditor(), strictWrapper.EnrichGameImages)
	r.GET("/games/:id", strictWrapper.GetGame)
	r.POST("/games", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateGame)
	r.PATCH("/games/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchGame)
	r.DELETE("/games/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeleteGame)
	// Arenas (ADR-24): public reads, editor-gated writes.
	r.GET("/arenas", strictWrapper.ListArenas)
	r.POST("/arenas", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateArena)
	r.GET("/arenas/:id", strictWrapper.GetArena)
	r.GET("/arenas/:id/players", strictWrapper.GetArenaPlayers)
	r.GET("/arenas/:id/feed", strictWrapper.ListArenaFeed)
	r.GET("/feed", strictWrapper.ListHomeFeed)
	r.PATCH("/arenas/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.UpdateArena)
	r.DELETE("/arenas/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeleteArena)
	// Admin update-arenas (ADR-24): the /debug page action.
	r.POST("/admin/update-arenas", o.DeserializeUser(), a.RequireEditor(), strictWrapper.UpdateArenas)
	r.POST("/clubs", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateClub)
	r.GET("/clubs", strictWrapper.ListClubs)
	r.GET("/clubs/:id", strictWrapper.GetClub)
	r.PATCH("/clubs/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchClub)
	r.DELETE("/clubs/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DeleteClub)
	r.POST("/clubs/:id/members", o.DeserializeUser(), a.RequireEditor(), strictWrapper.AddClubMember)
	r.GET("/clubs/:id/members/history", strictWrapper.ListClubMemberHistory)
	r.DELETE("/clubs/:id/members/:playerId", o.DeserializeUser(), a.RequireEditor(), strictWrapper.RemoveClubMember)
	// Tenants (ADR-36): the community surface.
	r.GET("/tenants", strictWrapper.ListTenants)
	r.POST("/tenants", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateTenant)
	r.GET("/tenants/:id", strictWrapper.GetTenant)
	r.PATCH("/tenants/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.PatchTenant)
	r.PUT("/tenants/:id/clubs", o.DeserializeUser(), a.RequireEditor(), strictWrapper.SetTenantClubs)
	r.GET("/tenants/:id/feed", strictWrapper.ListTenantFeed)
	r.GET("/audit", strictWrapper.ListAuditEvents)
	// Tournaments (ADR-26): public reads, editor-gated organization, the
	// self-registration behind the linked-player gate. Creation is
	// tenant-scoped (ADR-36).
	r.GET("/tournaments", strictWrapper.ListTournaments)
	r.POST("/tenants/:id/tournaments", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateTenantTournament)
	r.POST("/tenants/:id/markets", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CreateTenantMarket)
	r.GET("/tournaments/:id", strictWrapper.GetTournament)
	r.PUT("/tournaments/:id", o.DeserializeUser(), a.RequireEditor(), strictWrapper.UpdateTournament)
	r.GET("/tournaments/:id/bracket-plans", o.DeserializeUser(), a.RequireEditor(), strictWrapper.ListTournamentBracketPlans)
	r.POST("/tournaments/:id/registration", o.DeserializeUser(), a.RequirePlayerID(), strictWrapper.RegisterInTournament)
	r.DELETE("/tournaments/:id/registration", o.DeserializeUser(), a.RequirePlayerID(), strictWrapper.UnregisterFromTournament)
	r.POST("/tournaments/:id/start", o.DeserializeUser(), a.RequireEditor(), strictWrapper.StartTournament)
	r.POST("/tournaments/:id/cancel", o.DeserializeUser(), a.RequireEditor(), strictWrapper.CancelTournament)
	r.GET("/tournaments/:id/bracket", strictWrapper.GetTournamentBracket)
	r.PATCH("/tournaments/:id/slots/:sid", o.DeserializeUser(), a.RequireEditor(), strictWrapper.AdjustTournamentSlot)
	r.POST("/tournaments/:id/slots/:sid/matches", o.DeserializeUser(), a.RequireEditor(), strictWrapper.AttachTournamentSlotMatch)
	r.DELETE("/tournaments/:id/slots/:sid/matches/:mid", o.DeserializeUser(), a.RequireEditor(), strictWrapper.DetachTournamentSlotMatch)
	r.POST("/tournaments/:id/slots/:sid/ruling", o.DeserializeUser(), a.RequireEditor(), strictWrapper.SetTournamentSlotRuling)
	// Auth /me: raw gin handlers on the oauth2 handler, mirroring main.go.
	r.GET("/auth/me", o.DeserializeUser(), o.GetMe)
	r.PATCH("/auth/me", o.DeserializeUser(), o.PatchMe)
	// Markets: needed by the outcome-id idcodec roundtrip test (bet placement
	// and the resolved-market outcome id).
	r.GET("/markets", strictWrapper.ListMarkets)
	r.GET("/markets/:id", strictWrapper.GetMarket)
	r.GET("/markets/:id/probability-history", strictWrapper.GetMarketProbabilityHistory)
	r.POST("/markets/:id/bets", o.DeserializeUser(), strictWrapper.PlaceBet)
	r.POST("/markets/:id/guarantees", o.DeserializeUser(), strictWrapper.CreateMarketGuarantee)
	// Realtime SSE (ADR-13): the multiplexed global-topics stream; auth is
	// optional (anonymous callers silently get no "me" topic).
	r.GET("/events", o.OptionalDeserializeUser(), a.Events)
	// Live game tables (ADR-13, ADR-15, ADR-16): strict handlers behind the
	// same auth chain as main.go.
	noStore := func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
	tblPlayerAuth := []gin.HandlerFunc{o.DeserializeUser(), a.RequirePlayerID()}
	tbl := r.Group("/tables", noStore)
	tbl.GET("", strictWrapper.ListTables)
	tbl.GET("/:id", strictWrapper.GetTable)
	// Table creation is tenant-scoped (ADR-36 phase 7), player-gated like the
	// rest of the table group.
	r.POST("/tenants/:id/tables", append(append([]gin.HandlerFunc{noStore}, tblPlayerAuth...), strictWrapper.CreateTenantTable)...)
	tbl.PATCH("/:id/state", append(tblPlayerAuth, strictWrapper.UpdateTableState)...)
	tbl.POST("/:id/join", append(tblPlayerAuth, strictWrapper.JoinTable)...)
	tbl.POST("/:id/submit", append(tblPlayerAuth, strictWrapper.SubmitTable)...)
	tbl.POST("/:id/takeover", o.DeserializeUser(), strictWrapper.TakeoverTable)
	tbl.DELETE("/:id", append(tblPlayerAuth, strictWrapper.DeleteTable)...)
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

// setBetLimit funds a player for betting. Since ADR-36 phase 5 the bet limit
// is derived at read time from the player's latest elo in the market's tenant
// main arena (no stored column), so the helper seeds a synthetic arena
// settlement with the elo the formula needs — and raises K in the base
// settings row when the requested limit exceeds the K cap (tests needing that
// much headroom do not assert elo values).
func setBetLimit(t *testing.T, pool *pgxpool.Pool, tenantID, playerID idpkg.ID, limit float64) {
	t.Helper()
	ctx := context.Background()
	var k, d, starting float64
	if err := pool.QueryRow(ctx,
		`SELECT elo_const_k, elo_const_d, starting_elo FROM elo_settings WHERE effective_date = '-infinity'`,
	).Scan(&k, &d, &starting); err != nil {
		t.Fatalf("read elo settings: %v", err)
	}
	if limit > k {
		k = 2 * limit
		if _, err := pool.Exec(ctx, `UPDATE elo_settings SET elo_const_k = $1 WHERE effective_date = '-infinity'`, k); err != nil {
			t.Fatalf("raise K for %s: %v", playerID, err)
		}
	}
	// Invert CalcBetLimit: limit = K / (1 + 10^((starting − elo)/D)).
	elo := starting - d*math.Log10(k/limit-1)
	var arenaID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM arenas WHERE tenant_id = $1`, tenantID).Scan(&arenaID); err != nil {
		t.Fatalf("find main arena of tenant %s: %v", tenantID, err)
	}
	// A player with no settlements in the arena sits at the starting elo —
	// the natural limit when the target equals K/2 — so no seed is needed,
	// and inserting one would only distort the arena's rating chain.
	var hasRows bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM arena_settlements WHERE arena_id = $1::uuid AND player_id = $2::uuid)`, arenaID, playerID).Scan(&hasRows); err != nil {
		t.Fatalf("check arena settlements: %v", err)
	}
	if !hasRows && elo == starting {
		return
	}
	u, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate settlement id: %v", err)
	}
	// The synthetic settlement must postdate the player's existing chain in
	// the arena — the limit reads the LATEST settlement row — but stay in the
	// past so fixture matches added later still order after it.
	var seededAt time.Time
	var latest pgtype.Timestamptz
	err = pool.QueryRow(ctx, `SELECT max(date) FROM arena_settlements WHERE arena_id = $1::uuid AND player_id = $2::uuid`, arenaID, playerID).Scan(&latest)
	if err != nil {
		t.Fatalf("read latest settlement: %v", err)
	}
	if latest.Valid {
		seededAt = latest.Time.Add(time.Second)
	} else {
		seededAt = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO arena_settlements (id, arena_id, player_id, date, rating_after, elo_after, discriminator, elo_staked, elo_earned, rating_staked, rating_earned)
		 VALUES ($1, $2, $3, $4, $5, $5, 'match', 0, 0, 0, 0)`,
		idpkg.ID(u.String()), arenaID, playerID, seededAt, elo); err != nil {
		t.Fatalf("seed arena elo for %s: %v", playerID, err)
	}
}

// matchDate returns an RFC3339 timestamp for a fixture match: daysBack days
// before today, at the top of the current UTC hour plus minute minutes —
// never future and well inside the 30-day window, so bracket tests can build
// ordered fixture days (later rounds = smaller daysBack) without aging out
// of the match-date validation the way hardcoded 2026-09-* constants did.
func matchDate(daysBack, minute int) string {
	return time.Now().UTC().AddDate(0, 0, -daysBack).Truncate(time.Hour).
		Add(time.Duration(minute) * time.Minute).Format(time.RFC3339)
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
// layer on extra fields (CampArenaIDs, Calculator, …) via a spread:
//
//	opts := newMatchOpts(t); opts.CampArenaIDs = []idpkg.ID{camp.ID}
//
// or pass overrides inline:
//
//	newMatchOpts(t) // plain
func newMatchOpts(t *testing.T) elo.AddMatchOpts {
	t.Helper()
	return elo.AddMatchOpts{ID: newID(t)}
}

// createTestPlayer inserts a player and returns its ID. The player joins
// «Синие люди» with a -infinity stint — the pre-tenancy reality migration 068
// backfills (every player of the original community was a member since
// forever). Since the attribution phase (ADR-36 phase 2) the club predicate
// governs the global arena, so matches among these players keep settling into
// it; use createBareTestPlayer for guests.
func createTestPlayer(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	p := createBareTestPlayer(t, pool, name)
	if err := addBlueMenStint(context.Background(), pool, p); err != nil {
		t.Fatalf("add «Синие люди» stint for %q: %v", name, err)
	}
	return p
}

// createBareTestPlayer inserts a player with no club membership — a guest for
// the club-rule tests (ADR-36).
func createBareTestPlayer(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	p, err := q.CreatePlayer(context.Background(), db.CreatePlayerParams{ID: id, Name: name})
	if err != nil {
		t.Fatalf("create player %q: %v", name, err)
	}
	return p.ID
}

// addBlueMenStint opens a «Синие люди» stint since -infinity for the player.
func addBlueMenStint(ctx context.Context, pool *pgxpool.Pool, playerID idpkg.ID) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO player_club_membership (club_id, player_id, joined_at)
		 VALUES ($1, $2, '-infinity')`,
		blueMenClubUUID, playerID)
	return err
}

// createTestGame inserts a game and returns its ID.
func createTestGame(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	g, err := q.AddGame(context.Background(), db.AddGameParams{ID: id, NameEn: pgText(name), GameMode: elo.GameModeCompetitive})
	if err != nil {
		t.Fatalf("create game %q: %v", name, err)
	}
	return g.ID
}

// pgText mirrors the service layer's helper: the empty string maps to SQL NULL.
func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
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

// playerRatingRows returns all global arena settlement rows for a player, ordered by date.
func playerRatingRows(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) []db.ArenaRatingHistoryRow {
	t.Helper()
	rows, err := db.New(pool).ArenaRatingHistory(context.Background(), db.ArenaRatingHistoryParams{
		ArenaID:  "a2ea0000-0000-0000-0000-000000000001",
		PlayerID: playerID,
	})
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
		`SELECT elo_after FROM arena_settlements WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND player_id = $1 ORDER BY date DESC, id DESC LIMIT 1`,
		playerID,
	).Scan(&elo)
	if err != nil {
		t.Fatalf("latestElo for player %s: %v", playerID, err)
	}
	return elo
}

// marketSettlementRatingCount returns how many global arena settlement rows exist for a player with discriminator='market'.
func marketSettlementRatingCount(t *testing.T, pool *pgxpool.Pool, playerID idpkg.ID) int {
	t.Helper()
	var count int
	err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM arena_settlements WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND player_id = $1 AND discriminator = 'market'`,
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
		`SELECT COALESCE(SUM(elo_earned), 0) FROM arena_settlements WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND market_id = $1 AND player_id = $2`,
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
		`SELECT COALESCE(SUM(elo_staked + elo_earned), 0) FROM arena_settlements WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND market_id = $1 AND player_id = $2`,
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
		`SELECT COALESCE(elo_staked + elo_earned, 0) FROM arena_settlements
		 WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market_guarantor'`,
		marketID, playerID).Scan(&delta)
	if err != nil {
		t.Fatalf("guarantor delta for %s: %v", playerID, err)
	}
	return delta
}

// Service constructors with the arena service wired (ADR-24): tests build the
// same dependency graph main.go does. The arena updater's main-arena drain
// re-chains markets through the settlement sweep (ADR-36 phase 6), so the
// sweep is wired here exactly as in production.
func newArenaService(pool *pgxpool.Pool) *elo.ArenaService {
	arenaSvc := elo.NewArenaService(pool, nil)
	arenaSvc.Sweep = elo.NewMatchService(pool, elo.NewMarketService(pool), arenaSvc,
		elo.NewTournamentService(pool, arenaSvc, elo.NewMarketService(pool)))
	return arenaSvc
}

func newMatchService(pool *pgxpool.Pool) elo.IMatchService {
	arenaSvc := elo.NewArenaService(pool, nil)
	marketSvc := elo.NewMarketService(pool)
	// The market service is shared (as in api.New): the tournament service's
	// tournament-winner hooks settle through the same settlement path.
	matchSvc := elo.NewMatchService(pool, marketSvc, arenaSvc, elo.NewTournamentService(pool, arenaSvc, marketSvc))
	arenaSvc.Sweep = matchSvc
	return matchSvc
}

// drainArenas plays the background worker's part for a test: a no-debounce
// drain of every stale arena — the arena a tenant settings change queued
// included (ADR-36 phase 6 decoupled settings saves from the replay).
func drainArenas(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if err := newArenaService(pool).ReplayStaleArenas(context.Background()); err != nil {
		t.Fatalf("drain stale arenas: %v", err)
	}
}

func newTagService(pool *pgxpool.Pool) elo.ITagService {
	return elo.NewTagService(pool, newArenaService(pool))
}

func newGameService(pool *pgxpool.Pool) elo.IGameService {
	// No Tesera/BGG clients: service-level tests don't touch the catalogues.
	return elo.NewGameService(pool, newArenaService(pool), nil, nil)
}

// BlueMenArenaID re-exported for raw SQL assertions against the unified
// settlement table.
var globalArenaUUID = "a2ea0000-0000-0000-0000-000000000001"

// short encodes a canonical uuid to the Base58 wire form.
func short(canonical idpkg.ID) string {
	return string(canonical.Base58())
}

// doJSON performs one request against the test router with an optional
// bearer token and JSON body.
func doJSON(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// blueMenClubID is the «Синие люди» club id (ADR-05 grouping) — the club the
// test players auto-join, one of the two clubs of the «Синие люди» tenant.
var blueMenClubID = idpkg.ID(blueMenClubUUID)

// blueMenTenantUUID / blueMenTenantID is the «Синие люди» tenant (ADR-36,
// seeded by migration 068) — the owner fixture tournaments and markets get,
// whose main arena is the global arena.
const blueMenTenantUUID = "00000000-0000-0000-0000-000000000101"

var blueMenTenantID = idpkg.ID(blueMenTenantUUID)

// vkiClubUUID is the «Весёлые карточные игры» club — the second club of the
// «Синие люди» tenant (seeded by migration 061 with its production members).
const vkiClubUUID = "00000000-0000-0000-0000-000000000002"

var vkiClubID = idpkg.ID(vkiClubUUID)

func newTournamentService(pool *pgxpool.Pool) *elo.TournamentService {
	arenaSvc := newArenaService(pool)
	marketSvc := elo.NewMarketService(pool)
	return elo.NewTournamentService(pool, arenaSvc, marketSvc)
}

// mustID parses a wire-form id, failing the test on garbage.
func mustID(t *testing.T, raw string) idpkg.ID {
	t.Helper()
	v, err := idpkg.ParseTolerant(raw)
	if err != nil {
		t.Fatalf("parse id %q: %v", raw, err)
	}
	return v
}

// arenaMarketRows counts a market's settlement rows (both roles) in one arena.
func arenaMarketRows(t *testing.T, pool *pgxpool.Pool, arena, market idpkg.ID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM arena_settlements WHERE arena_id = $1 AND market_id = $2`,
		arena, market).Scan(&n); err != nil {
		t.Fatalf("count market rows: %v", err)
	}
	return n
}
