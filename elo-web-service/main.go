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

	go apiHandler.MarketService.ScheduleNextExpiry(context.Background())
	go apiHandler.TableService.ScheduleNextCleanup(context.Background())

	router := gin.Default()

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
	router.GET("/players/:id/stats", strictWrapper.GetPlayerStats)
	router.POST("/players", append(editorAuth(), strictWrapper.CreatePlayer)...)
	router.PATCH("/players/:id", append(editorAuth(), strictWrapper.PatchPlayer)...)
	router.DELETE("/players/:id", append(editorAuth(), strictWrapper.DeletePlayer)...)

	// Users
	router.GET("/users", strictWrapper.ListUsers)
	router.PATCH("/users/:userId", append(editorAuth(), strictWrapper.PatchUser)...)

	// Matches
	router.GET("/matches", strictWrapper.ListMatches)
	router.POST("/matches", append(editorAuth(), strictWrapper.AddMatch)...)
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
	router.GET("/games/:id", strictWrapper.GetGame)
	router.GET("/games/:id/matches", strictWrapper.GetGameMatches)
	router.DELETE("/games/:id", append(editorAuth(), strictWrapper.DeleteGame)...)
	router.PATCH("/games/:id", append(editorAuth(), strictWrapper.PatchGame)...)
	router.POST("/games", append(editorAuth(), strictWrapper.CreateGame)...)
	router.POST("/admin/recalculate-game-elo", strictWrapper.RecalculateGameElo)
	router.POST("/admin/players/:id/corrections", append(editorAuth(), strictWrapper.CreatePlayerCorrection)...)
	router.GET("/corrections", strictWrapper.ListCorrections)

	// Live game tables (generic; per-game behavior dispatched by game_id).
	// The whole group is no-store: table state mutates constantly, and a
	// stale snapshot served from any HTTP/SW cache is worse than an error.
	noStore := func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() }
	tbl := router.Group("/tables", noStore)
	tbl.GET("", apiHandler.ListTables)
	tbl.POST("", append(playerAuth(), apiHandler.CreateTable)...)
	tbl.GET("/:id", apiHandler.GetTable)
	tbl.PATCH("/:id/state", append(playerAuth(), apiHandler.UpdateTableState)...)
	tbl.POST("/:id/join", append(playerAuth(), apiHandler.JoinTable)...)
	tbl.POST("/:id/submit", append(playerAuth(), apiHandler.SubmitTable)...)
	// Takeover needs a session; the handler allows the current host to
	// re-claim (host resume on another device) and everyone else only with
	// edit permission.
	tbl.POST("/:id/takeover", oauth2Handler.DeserializeUser(), apiHandler.TakeoverTable)
	tbl.DELETE("/:id", append(playerAuth(), apiHandler.DeleteTable)...)
	tbl.GET("/:id/events", apiHandler.TableEvents)
	// Lobby SSE — separate path to avoid colliding with the /:id wildcard above
	router.GET("/tables/lobby/events", noStore, apiHandler.TablesLobbyEvents)

	// Clubs
	router.GET("/clubs", strictWrapper.ListClubs)
	router.GET("/clubs/:id", strictWrapper.GetClub)
	router.POST("/clubs", append(editorAuth(), strictWrapper.CreateClub)...)
	router.PATCH("/clubs/:id", append(editorAuth(), strictWrapper.PatchClub)...)
	router.DELETE("/clubs/:id", append(editorAuth(), strictWrapper.DeleteClub)...)
	router.POST("/clubs/:id/members", append(editorAuth(), strictWrapper.AddClubMember)...)
	router.DELETE("/clubs/:id/members/:playerId", append(editorAuth(), strictWrapper.RemoveClubMember)...)

	// Tournaments
	router.GET("/tournaments", strictWrapper.ListTournaments)
	router.GET("/tournaments/:id", strictWrapper.GetTournament)
	router.GET("/tournaments/:id/stats", strictWrapper.GetTournamentStats)
	router.POST("/tournaments", append(editorAuth(), strictWrapper.CreateTournament)...)
	router.PUT("/tournaments/:id", append(editorAuth(), strictWrapper.UpdateTournament)...)
	router.DELETE("/tournaments/:id", append(editorAuth(), strictWrapper.DeleteTournament)...)

	// Markets
	router.GET("/markets", oauth2Handler.OptionalDeserializeUser(), strictWrapper.ListMarkets)
	router.POST("/markets", append(editorAuth(), strictWrapper.CreateMarket)...)
	router.GET("/markets/:id", oauth2Handler.OptionalDeserializeUser(), strictWrapper.GetMarket)
	router.PATCH("/markets/:id", append(editorAuth(), strictWrapper.PatchMarket)...)
	router.DELETE("/markets/:id", append(editorAuth(), strictWrapper.DeleteMarket)...)
	router.POST("/markets/:id/bets", oauth2Handler.DeserializeUser(), strictWrapper.PlaceBet)
	router.GET("/markets/:id/probability-history", strictWrapper.GetMarketProbabilityHistory)
	// Market SSE — lobby path before the /:id wildcard to avoid collision.
	router.GET("/markets/lobby/events", apiHandler.MarketsLobbyEvents)
	router.GET("/markets/:id/events", apiHandler.MarketEvents)

	// Audit log — public read, latest first (ADR-14); events are written inside
	// the audited mutations' transactions.
	router.GET("/audit", strictWrapper.ListAuditEvents)

	// Realtime SSE — global data-change signals (public) and per-user events
	// (invites, match notifications). Both paths end in /events so the frontend
	// service worker's NetworkOnly exclusion covers them.
	router.GET("/data/events", apiHandler.DataEvents)
	router.GET("/me/events", oauth2Handler.DeserializeUser(), apiHandler.MeEvents)

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
