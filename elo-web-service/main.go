package main

import (
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func main() {
	ReadConfiguration()
	googlesheet.Init(Config.GoogleServiceAccountKey, Config.DocID)

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type"},
	}))

	router.OPTIONS("/matches", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	router.GET("/ping", getPing)
	router.GET("/players", ListPlayers)
	router.GET("/matches", ListMatches)
	router.POST("/matches", AddMatch)

	router.Run(Config.Address)
}

func getPing(c *gin.Context) {
	c.String(http.StatusOK, "pong")
}
