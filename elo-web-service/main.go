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
	"github.com/tolyandre/elo-web-service/pkg/elo"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func main() {
	cfg.ReadConfiguration()
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
	userService := elo.NewUserService(pool)
	api := api.New(pool, userService)
	oauth2 := oauth2.New(pool, userService)

	googlesheet.Init(cfg.Config.GoogleServiceAccountKey, cfg.Config.DocID)

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
	router.GET("/users", api.ListUsers)
	router.PATCH("/users/:userId", oauth2.DeserializeUser(), api.PatchUser)
	router.GET("/matches", api.ListMatches)
	router.POST("/matches", oauth2.DeserializeUser(), api.AddMatch)
	router.GET("/settings", api.ListSettings)
	router.GET("/games", api.ListGames)
	router.GET("/games/:id", api.GetGame)
	router.DELETE("/cache", api.DeleteCache)
	router.GET("/clubs", api.ListClubs)

	auth_router := router.Group("/auth")
	auth_router.POST("/logout", oauth2.LogoutUser)
	auth_router.GET("/login", oauth2.Login)
	auth_router.GET("/oauth2-callback", oauth2.GoogleOAuth)
	auth_router.GET("/me", oauth2.DeserializeUser(), oauth2.GetMe)

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
