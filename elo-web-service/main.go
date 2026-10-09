package main

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tolyandre/elo-web-service/pkg/api"
	oauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func main() {
	cfg.ReadConfiguration()

	// --migrate-db-dsn: run migrations against an explicit DSN, no full config required.
	if cfg.MigrateDBDSN != "" {
		runMigrations(cfg.MigrateDBDSN, true)
		log.Println("migrations applied; exiting as --migrate-db-dsn was provided")
		return
	}

	if cfg.MigrateDB {
		// --migrate-db: apply schema migrations via the configured DSN, then exit.
		if dsn, err := db.BuildDSN(); err == nil {
			runMigrations(dsn, true)
		}
		log.Println("migrations applied; exiting as --migrate-db was provided")
		return
	}

	pool := initDbConnectionPool()
	defer pool.Close()
	// Run in-process data migrations (calculator schema upgrades, etc.) on every
	// normal boot too. No-op when nothing is out of date.
	if dsn, err := db.BuildDSN(); err == nil {
		runMigrations(dsn, false)
	}
	apiHandler := api.New(pool)
	oauth2Handler := oauth2.New(pool)

	// Stale arenas (a migration re-mark, a fresh arena, a queued tenant
	// main-arena recalculation) drain at boot, before the API starts serving
	// — no debounce, unlike the background worker (ADR-36 phase 6).
	if err := apiHandler.ArenaService.ReplayStaleArenas(context.Background()); err != nil {
		log.Fatalf("stale arena replay failed: %v", err)
	}

	go apiHandler.MarketService.ScheduleNextExpiry(context.Background())
	go apiHandler.TableService.ScheduleNextCleanup(context.Background())
	// Arena updater (ADR-24): recalculates stale arenas (tag-driven filter
	// changes, new arenas) after a debounce; match writes drain synchronously.
	go apiHandler.ArenaService.ScheduleNextUpdate(context.Background())

	// gin.New + explicit middleware instead of gin.Default(): the built-in
	// Recovery answers panics with a bare 500 and an empty body; JSONRecovery
	// answers in the common {"status":"fail","message":...} envelope.
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(api.JSONRecovery())

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{getDomainWithScheme(cfg.Config.FrontendUri)},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type"},
		AllowCredentials: true,
	}))

	router.OPTIONS("/matches", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// strictWrapper wraps the StrictServer via ServerInterfaceWrapper so that
	// path-parameter methods (e.g. GetPlayerStats) are exposed as plain gin.HandlerFunc.
	// Auth middleware is still applied per-route below, preserving the existing behavior.
	// errorMiddleware converts unexpected handler errors (nil, err) into a JSON
	// response with the same {"status":"fail","message":"..."} shape as typed errors.
	errorMiddleware := func(f api.StrictHandlerFunc, operationID string) api.StrictHandlerFunc {
		return func(ctx *gin.Context, req interface{}) (interface{}, error) {
			resp, err := f(ctx, req)
			if err != nil {
				ctx.JSON(http.StatusInternalServerError, gin.H{
					"status":  "fail",
					"message": err.Error(),
				})
				ctx.Abort()
				return nil, nil
			}
			return resp, nil
		}
	}

	strictWrapper := &api.ServerInterfaceWrapper{
		Handler: api.NewStrictHandler(api.NewStrictServer(apiHandler, oauth2Handler), []api.StrictMiddlewareFunc{errorMiddleware}),
		// Binding failures (a missing required query parameter, a malformed
		// path parameter) answer in the common envelope; a nil handler would
		// panic instead.
		ErrorHandler: func(c *gin.Context, err error, status int) {
			c.JSON(status, gin.H{"status": "fail", "message": err.Error()})
		},
	}

	// editorAuth returns the standard editor-gated middleware chain (valid
	// session + editor permission) used across all write routes.
	editorAuth := func() []gin.HandlerFunc {
		return []gin.HandlerFunc{oauth2Handler.DeserializeUser(), apiHandler.RequireEditor()}
	}
	// playerAuth is the player-gated chain (valid session + linked player) used
	// by the live game-table routes.
	playerAuth := func() []gin.HandlerFunc {
		return []gin.HandlerFunc{oauth2Handler.DeserializeUser(), apiHandler.RequirePlayerID()}
	}

	router.GET("/ping", strictWrapper.GetPing)

	// Players
	router.GET("/players", strictWrapper.ListPlayers)
	// "Недавние" picker candidates for the signed-in user — before /players/:id.
	router.GET("/players/recent", oauth2Handler.DeserializeUser(), strictWrapper.ListRecentPlayers)
	router.GET("/players/:id/stats", strictWrapper.GetPlayerStats)
	router.POST("/players", append(editorAuth(), strictWrapper.CreatePlayer)...)
	router.PATCH("/players/:id", append(editorAuth(), strictWrapper.PatchPlayer)...)
	router.DELETE("/players/:id", append(editorAuth(), strictWrapper.DeletePlayer)...)

	// Users
	router.GET("/users", strictWrapper.ListUsers)
	router.PATCH("/users/:userId", append(editorAuth(), strictWrapper.PatchUser)...)

	// Matches. Creation is tenant-scoped (ADR-36 phase 7): POST under the
	// owning tenant (registered with the other tenant routes); reads and edits
	// stay on the flat routes with ?tenant=.
	router.GET("/matches", strictWrapper.ListMatches)
	router.GET("/matches/:id", strictWrapper.GetMatchById)
	router.GET("/matches/:id/markets", strictWrapper.GetMarketsByMatchId)
	router.PUT("/matches/:id", append(editorAuth(), strictWrapper.UpdateMatch)...)

	// Settings
	router.GET("/settings", strictWrapper.GetSettings)
	router.GET("/settings/all", strictWrapper.ListAllSettings)
	router.POST("/settings", append(editorAuth(), strictWrapper.CreateSettings)...)
	router.DELETE("/settings", append(editorAuth(), strictWrapper.DeleteSettings)...)

	// Games
	router.GET("/games", strictWrapper.ListGames)
	// The game picker's «Избранные» tab for the signed-in user — before /games/:id.
	router.GET("/games/favorites", oauth2Handler.DeserializeUser(), strictWrapper.ListFavoriteGames)
	router.GET("/games/suggestions", append(editorAuth(), strictWrapper.SuggestGames)...)
	router.POST("/games/auto-match", append(editorAuth(), strictWrapper.AutoMatchGames)...)
	router.POST("/games/bgg-enrich", append(editorAuth(), strictWrapper.EnrichGameImages)...)
	router.GET("/games/:id", strictWrapper.GetGame)
	router.DELETE("/games/:id", append(editorAuth(), strictWrapper.DeleteGame)...)
	router.PATCH("/games/:id", append(editorAuth(), strictWrapper.PatchGame)...)
	router.POST("/games", append(editorAuth(), strictWrapper.CreateGame)...)
	// Debug/monitoring: update all arenas to the actual state (full replay
	// with a per-arena diff). Editor-gated like every other write route; the
	// page for it is /debug (unlinked).
	router.POST("/admin/update-arenas", append(editorAuth(), strictWrapper.UpdateArenas)...)

	// Arenas (ADR-24) — public reads, editor-gated writes. /arenas/:id/feed is
	// the arena feed, /feed the main page's home feed (ADR-32).
	router.GET("/arenas", strictWrapper.ListArenas)
	router.POST("/arenas", append(editorAuth(), strictWrapper.CreateArena)...)
	router.GET("/arenas/:id", strictWrapper.GetArena)
	router.GET("/arenas/:id/players", strictWrapper.GetArenaPlayers)
	router.GET("/arenas/:id/feed", strictWrapper.ListArenaFeed)
	router.GET("/feed", strictWrapper.ListHomeFeed)
	router.PATCH("/arenas/:id", append(editorAuth(), strictWrapper.UpdateArena)...)
	router.DELETE("/arenas/:id", append(editorAuth(), strictWrapper.DeleteArena)...)

	// Live game tables (generic; per-game behavior dispatched by game_id).
	// The whole group is no-store: table state mutates constantly, and a
	// stale snapshot served from any HTTP/SW cache is worse than an error.
	noStore := func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
	tbl := router.Group("/tables", noStore)
	tbl.GET("", strictWrapper.ListTables)
	tbl.GET("/:id", strictWrapper.GetTable)
	tbl.PATCH("/:id/state", append(playerAuth(), strictWrapper.UpdateTableState)...)
	tbl.POST("/:id/join", append(playerAuth(), strictWrapper.JoinTable)...)
	tbl.POST("/:id/submit", append(playerAuth(), strictWrapper.SubmitTable)...)
	// Takeover needs a session; the handler allows the current host to
	// re-claim (host resume on another device) and everyone else only with
	// edit permission.
	tbl.POST("/:id/takeover", oauth2Handler.DeserializeUser(), strictWrapper.TakeoverTable)
	tbl.DELETE("/:id", append(playerAuth(), strictWrapper.DeleteTable)...)
	// SSE is intentionally not in the OpenAPI spec — raw gin handler.
	tbl.GET("/:id/events", apiHandler.TableEvents)

	// Clubs
	router.GET("/clubs", strictWrapper.ListClubs)
	router.GET("/clubs/:id", strictWrapper.GetClub)
	router.POST("/clubs", append(editorAuth(), strictWrapper.CreateClub)...)
	router.PATCH("/clubs/:id", append(editorAuth(), strictWrapper.PatchClub)...)
	router.DELETE("/clubs/:id", append(editorAuth(), strictWrapper.DeleteClub)...)
	router.POST("/clubs/:id/members", append(editorAuth(), strictWrapper.AddClubMember)...)
	router.GET("/clubs/:id/members/history", strictWrapper.ListClubMemberHistory)
	router.DELETE("/clubs/:id/members/:playerId", append(editorAuth(), strictWrapper.RemoveClubMember)...)

	// Tenants (ADR-36): the community surface — lifecycle, openness settings,
	// club composition, feed, and the tenant-scoped tournaments and markets
	// (the path tenant must exist; the services validate it).
	router.GET("/tenants", strictWrapper.ListTenants)
	router.GET("/tenants/:id", strictWrapper.GetTenant)
	router.GET("/tenants/:id/feed", strictWrapper.ListTenantFeed)
	router.POST("/tenants", append(editorAuth(), strictWrapper.CreateTenant)...)
	router.PATCH("/tenants/:id", append(editorAuth(), strictWrapper.PatchTenant)...)
	router.PUT("/tenants/:id/clubs", append(editorAuth(), strictWrapper.SetTenantClubs)...)
	router.POST("/tenants/:id/tournaments", append(editorAuth(), strictWrapper.CreateTenantTournament)...)
	router.POST("/tenants/:id/markets", append(editorAuth(), strictWrapper.CreateTenantMarket)...)
	router.POST("/tenants/:id/matches", append(editorAuth(), strictWrapper.CreateTenantMatch)...)
	// A table stays player-gated like its join/submit siblings: any linked
	// player may host one (the saved match at the end is editor-gated as
	// before).
	router.POST("/tenants/:id/tables", append(playerAuth(), strictWrapper.CreateTenantTable)...)

	// Tags — shared game-tag vocabulary (many-to-many via /games/:id/tags).
	router.GET("/tags", strictWrapper.ListTags)
	router.POST("/tags", append(editorAuth(), strictWrapper.CreateTag)...)
	router.PATCH("/tags/:id", append(editorAuth(), strictWrapper.PatchTag)...)
	router.DELETE("/tags/:id", append(editorAuth(), strictWrapper.DeleteTag)...)
	router.POST("/games/:id/tags", append(editorAuth(), strictWrapper.AddGameTag)...)
	router.DELETE("/games/:id/tags/:tagId", append(editorAuth(), strictWrapper.RemoveGameTag)...)

	// Markets
	router.GET("/markets", oauth2Handler.OptionalDeserializeUser(), strictWrapper.ListMarkets)
	router.GET("/markets/:id", oauth2Handler.OptionalDeserializeUser(), strictWrapper.GetMarket)
	router.PATCH("/markets/:id", append(editorAuth(), strictWrapper.PatchMarket)...)
	router.DELETE("/markets/:id", append(editorAuth(), strictWrapper.DeleteMarket)...)
	router.POST("/markets/:id/bets", oauth2Handler.DeserializeUser(), strictWrapper.PlaceBet)
	router.POST("/markets/:id/guarantees", oauth2Handler.DeserializeUser(), strictWrapper.CreateMarketGuarantee)
	router.GET("/markets/:id/probability-history", strictWrapper.GetMarketProbabilityHistory)
	router.GET("/markets/:id/events", apiHandler.MarketEvents)

	// Audit log — public read, latest first (ADR-14); events are written inside
	// the audited mutations' transactions.
	router.GET("/audit", strictWrapper.ListAuditEvents)

	// Tournaments (ADR-26) — public reads, editor-gated organization, the
	// self-registration behind the linked-player gate. Creation is
	// tenant-scoped: POST /tenants/:id/tournaments (ADR-36).
	router.GET("/tournaments", strictWrapper.ListTournaments)
	router.GET("/tournaments/:id", strictWrapper.GetTournament)
	router.PUT("/tournaments/:id", append(editorAuth(), strictWrapper.UpdateTournament)...)
	router.GET("/tournaments/:id/bracket-plans", append(editorAuth(), strictWrapper.ListTournamentBracketPlans)...)
	router.POST("/tournaments/:id/registration", append(playerAuth(), strictWrapper.RegisterInTournament)...)
	router.DELETE("/tournaments/:id/registration", append(playerAuth(), strictWrapper.UnregisterFromTournament)...)
	router.POST("/tournaments/:id/start", append(editorAuth(), strictWrapper.StartTournament)...)
	router.POST("/tournaments/:id/cancel", append(editorAuth(), strictWrapper.CancelTournament)...)
	router.GET("/tournaments/:id/bracket", strictWrapper.GetTournamentBracket)
	router.PATCH("/tournaments/:id/slots/:sid", append(editorAuth(), strictWrapper.AdjustTournamentSlot)...)
	router.POST("/tournaments/:id/slots/:sid/matches", append(editorAuth(), strictWrapper.AttachTournamentSlotMatch)...)
	router.DELETE("/tournaments/:id/slots/:sid/matches/:mid", append(editorAuth(), strictWrapper.DetachTournamentSlotMatch)...)
	router.POST("/tournaments/:id/slots/:sid/ruling", append(editorAuth(), strictWrapper.SetTournamentSlotRuling)...)

	// Realtime SSE — one multiplexed stream of the app-global topics (global
	// data-change signals, both lobby signals, per-user events) picked via
	// ?topics=. Auth is optional: anonymous callers silently get no "me"
	// topic. The path ends in /events so the frontend service worker's
	// NetworkOnly exclusion covers it.
	router.GET("/events", oauth2Handler.OptionalDeserializeUser(), apiHandler.Events)

	// Auth (delegated to oauth2Handler via StrictServer stubs)
	authRouter := router.Group("/auth")
	authRouter.POST("/logout", oauth2Handler.LogoutUser)
	authRouter.GET("/login", oauth2Handler.Login)
	authRouter.GET("/oauth2-callback", oauth2Handler.GoogleOAuth)
	authRouter.GET("/me", oauth2Handler.DeserializeUser(), oauth2Handler.GetMe)
	authRouter.PATCH("/me", oauth2Handler.DeserializeUser(), oauth2Handler.PatchMe)

	log.Fatal(router.Run(cfg.Config.Address))
}

// runMigrations applies schema (when runSchema is true) and calculator data
// migrations against dsn, exiting the process on failure. Schema migrations are
// only run in the --migrate-db / --migrate-db-dsn one-shot modes; normal boot
// runs only the idempotent in-process data migration.
func runMigrations(dsn string, runSchema bool) {
	if runSchema {
		if err := db.MigrateUpWithDSN(dsn); err != nil {
			log.Fatalf("migrations failed: %v", err)
			os.Exit(1)
		}
	}
	if err := db.MigrateCalculatorData(context.Background(), dsn); err != nil {
		log.Fatalf("calculator data migration failed: %v", err)
		os.Exit(1)
	}
}

func initDbConnectionPool() *pgxpool.Pool {
	ctx := context.Background()
	dsn, err := db.BuildDSN()
	if err != nil {
		log.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatal(err)
	}

	return pool
}

func getDomainWithScheme(uri string) string {
	u, err := url.Parse(uri)
	origin := uri
	if err == nil && u.Scheme != "" && u.Host != "" {
		origin = u.Scheme + "://" + u.Host
	}
	return origin
}
