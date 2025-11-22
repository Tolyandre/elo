package main

import (
	"log"
	"net/http"
	"net/url"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/tolyandre/elo-web-service/pkg/api"
	oauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func main() {
	cfg.ReadConfiguration()
	googlesheet.Init(cfg.Config.GoogleServiceAccountKey, cfg.Config.DocID)
	oauth2.InitOauth()

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

	router.GET("/ping", getPing)
	router.GET("/players", api.ListPlayers)
	router.GET("/matches", api.ListMatches)
	router.POST("/matches", oauth2.DeserializeUser(), api.AddMatch)
	router.GET("/settings", api.ListSettings)
	router.GET("/games", api.ListGames)
	router.GET("/games/:id", api.GetGame)
	router.DELETE("/cache", api.DeleteCache)

	auth_router := router.Group("/auth")
	auth_router.POST("/logout", oauth2.LogoutUser)
	auth_router.GET("/login", oauth2.Login)
	auth_router.GET("/oauth2-callback", oauth2.GoogleOAuth)
	auth_router.GET("/me", oauth2.DeserializeUser(), oauth2.GetMe)

	log.Fatal(router.Run(cfg.Config.Address))
}

func getDomainWithScheme(uri string) string {
	u, err := url.Parse(uri)
	origin := uri
	if err == nil && u.Scheme != "" && u.Host != "" {
		origin = u.Scheme + "://" + u.Host
	}
	return origin
}

func getPing(c *gin.Context) {
	api.SuccessMessageResponse(c, http.StatusOK, "pong")
}
