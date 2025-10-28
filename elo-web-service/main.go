package main

import (
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/tolyandre/elo-web-service/pkg/api"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func main() {
	ReadConfiguration()
	googlesheet.Init(Config.GoogleServiceAccountKey, Config.DocID)

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type"},
	}))

	router.OPTIONS("/matches", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	router.GET("/ping", getPing)
	router.GET("/players", api.ListPlayers)
	router.GET("/matches", api.ListMatches)
	router.POST("/matches", api.AddMatch)
	router.GET("/settings", api.ListSettings)
	router.GET("/games", api.ListGames)
	router.DELETE("/cache", api.DeleteCache)
	router.Run(Config.Address)
}

func getPing(c *gin.Context) {
	c.String(http.StatusOK, "pong")
}
