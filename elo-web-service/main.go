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
		if err := db.MigrateUpWithDSN(cfg.MigrateDBDSN); err != nil {
			log.Fatalf("migrations failed: %v", err)
			os.Exit(1)
		}
		log.Println("migrations applied; exiting as --migrate-db-dsn was provided")
		return
	}

	if cfg.MigrateDB {
		if err := db.MigrateUp(); err != nil {
			log.Fatalf("migrations failed: %v", err)
			os.Exit(1)
		}
		log.Println("migrations applied; exiting as --migrate-db was provided")
		return
	}

	pool := initDbConnectionPool()
	defer pool.Close()
	apiHandler := api.New(pool)
	oauth2Handler := oauth2.New(pool)

	// Start timer for time-based market expiry
	apiHandler.MarketService.ScheduleNextExpiry(context.Background())

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

	router.GET("/ping", strictWrapper.GetPing)

	// Players
	router.GET("/players", strictWrapper.ListPlayers)
	router.GET("/players/:id/stats", strictWrapper.GetPlayerStats)
	router.POST("/players", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.CreatePlayer)
	router.PATCH("/players/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.PatchPlayer)
	router.DELETE("/players/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.DeletePlayer)

	// Users
	router.GET("/users", strictWrapper.ListUsers)
	router.PATCH("/users/:userId", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.PatchUser)

	// Matches
	router.GET("/matches", strictWrapper.ListMatches)
	router.POST("/matches", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.AddMatch)
	router.GET("/matches/:id", strictWrapper.GetMatchById)
	router.GET("/matches/:id/markets", strictWrapper.GetMarketsByMatchId)
	router.PUT("/matches/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.UpdateMatch)

	// Settings
	router.GET("/settings", strictWrapper.GetSettings)
	router.GET("/settings/all", strictWrapper.ListAllSettings)
	router.POST("/settings", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.CreateSettings)
	router.DELETE("/settings", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.DeleteSettings)

	// Games
	router.GET("/games", strictWrapper.ListGames)
	router.GET("/games/:id", strictWrapper.GetGame)
	router.GET("/games/:id/matches", strictWrapper.GetGameMatches)
	router.DELETE("/games/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.DeleteGame)
	router.PATCH("/games/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.PatchGame)
	router.POST("/games", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.CreateGame)
	router.POST("/admin/recalculate-game-elo", strictWrapper.RecalculateGameElo)

	// Voice
	router.POST("/voice/parse", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.ParseVoiceInput)

	// Skull King calculator
	router.POST("/skull-king/parse-card-image", apiHandler.ParseSkullKingCardImage)

	// Clubs
	router.GET("/clubs", strictWrapper.ListClubs)
	router.GET("/clubs/:id", strictWrapper.GetClub)
	router.POST("/clubs", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.CreateClub)
	router.PATCH("/clubs/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.PatchClub)
	router.DELETE("/clubs/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.DeleteClub)
	router.POST("/clubs/:id/members", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.AddClubMember)
	router.DELETE("/clubs/:id/members/:playerId", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.RemoveClubMember)

	// Markets
	router.GET("/markets", oauth2Handler.OptionalDeserializeUser(), strictWrapper.ListMarkets)
	router.POST("/markets", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.CreateMarket)
	router.GET("/markets/:id", oauth2Handler.OptionalDeserializeUser(), strictWrapper.GetMarket)
	router.PATCH("/markets/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.PatchMarket)
	router.DELETE("/markets/:id", oauth2Handler.DeserializeUser(), apiHandler.RequireEditor(), strictWrapper.DeleteMarket)
	router.POST("/markets/:id/bets", oauth2Handler.DeserializeUser(), strictWrapper.PlaceBet)

	// Auth (delegated to oauth2Handler via StrictServer stubs)
	authRouter := router.Group("/auth")
	authRouter.POST("/logout", oauth2Handler.LogoutUser)
	authRouter.GET("/login", oauth2Handler.Login)
	authRouter.GET("/oauth2-callback", oauth2Handler.GoogleOAuth)
	authRouter.GET("/me", oauth2Handler.DeserializeUser(), oauth2Handler.GetMe)
	authRouter.PATCH("/me", oauth2Handler.DeserializeUser(), oauth2Handler.PatchMe)

	log.Fatal(router.Run(cfg.Config.Address))
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
