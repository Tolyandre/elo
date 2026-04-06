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
	api := api.New(pool)
	oauth2 := oauth2.New(pool)

	// Start timer for time-based market expiry
	api.MarketService.ScheduleNextExpiry(context.Background())

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

	router.GET("/ping", api.GetPing)
	router.GET("/players", api.ListPlayers)
	router.GET("/players/:id/stats", api.GetPlayerStats)
	router.POST("/players", oauth2.DeserializeUser(), api.RequireEditor(), api.CreatePlayer)
	router.PATCH("/players/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.PatchPlayer)
	router.DELETE("/players/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.DeletePlayer)
	router.GET("/users", api.ListUsers)
	router.PATCH("/users/:userId", oauth2.DeserializeUser(), api.RequireEditor(), api.PatchUser)
	router.GET("/matches", api.ListMatches)
	router.POST("/matches", oauth2.DeserializeUser(), api.RequireEditor(), api.AddMatch)
	router.GET("/matches/:id", api.GetMatchById)
	router.GET("/matches/:id/markets", api.GetMarketsByMatchID)
	router.PUT("/matches/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.UpdateMatch)
	router.GET("/settings", api.ListSettings)
	router.GET("/settings/all", api.ListAllSettings)
	router.POST("/settings", oauth2.DeserializeUser(), api.RequireEditor(), api.CreateSettings)
	router.DELETE("/settings", oauth2.DeserializeUser(), api.RequireEditor(), api.DeleteSettings)
	router.GET("/games", api.ListGames)
	router.GET("/games/:id", api.GetGame)
	router.GET("/games/:id/matches", api.GetGameMatches)
	router.DELETE("/games/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.DeleteGame)
	router.PATCH("/games/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.PatchGame)
	router.POST("/games", oauth2.DeserializeUser(), api.RequireEditor(), api.CreateGame)
	router.POST("/admin/recalculate-game-elo", api.RecalculateGameElo)
	router.POST("/voice/parse", oauth2.DeserializeUser(), api.RequireEditor(), api.ParseVoiceInput)
	router.GET("/clubs", api.ListClubs)
	router.GET("/clubs/:id", api.GetClub)
	router.POST("/clubs", oauth2.DeserializeUser(), api.RequireEditor(), api.CreateClub)
	router.PATCH("/clubs/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.PatchClub)
	router.DELETE("/clubs/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.DeleteClub)
	router.POST("/clubs/:id/members", oauth2.DeserializeUser(), api.RequireEditor(), api.AddClubMember)
	router.DELETE("/clubs/:id/members/:playerId", oauth2.DeserializeUser(), api.RequireEditor(), api.RemoveClubMember)

	router.GET("/markets", oauth2.OptionalDeserializeUser(), api.ListMarkets)
	router.POST("/markets", oauth2.DeserializeUser(), api.RequireEditor(), api.CreateMarket)
	router.GET("/markets/:id", oauth2.OptionalDeserializeUser(), api.GetMarket)
	router.PATCH("/markets/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.PatchMarket)
	router.DELETE("/markets/:id", oauth2.DeserializeUser(), api.RequireEditor(), api.DeleteMarket)
	router.POST("/markets/:id/bets", oauth2.DeserializeUser(), api.PlaceBet)

	auth_router := router.Group("/auth")
	auth_router.POST("/logout", oauth2.LogoutUser)
	auth_router.GET("/login", oauth2.Login)
	auth_router.GET("/oauth2-callback", oauth2.GoogleOAuth)
	auth_router.GET("/me", oauth2.DeserializeUser(), oauth2.GetMe)
	auth_router.PATCH("/me", oauth2.DeserializeUser(), oauth2.PatchMe)

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
