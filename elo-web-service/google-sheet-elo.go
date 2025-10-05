package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type Player struct {
	ID  string  `json:"id"`
	Elo float64 `json:"elo"`
}

type Match struct {
	Game  string             `json:"game" binding:"required"`
	Score map[string]float64 `json:"score" binding:"required"`
}

var sheetsService *sheets.Service

func InitGoogleSheetsService() {
	ctx := context.Background()
	credentials, err := ioutil.ReadFile(*KeyFilePath)
	if err != nil {
		log.Fatal("unable to read key file:", err)
	}

	scopes := []string{
		"https://www.googleapis.com/auth/spreadsheets",
	}
	config, err := google.JWTConfigFromJSON(credentials, scopes...)
	if err != nil {
		log.Fatal("unable to create JWT configuration:", err)
	}

	sheetsService, err = sheets.NewService(ctx, option.WithHTTPClient(config.Client(ctx)))
	if err != nil {
		log.Fatalf("unable to retrieve sheets service: %v", err)
	}
}

func GetPlayers(c *gin.Context) {
	val, err := sheetsService.Spreadsheets.Values.Get(*DocId, "Elo v2!C1:500").Do()
	if err != nil {
		log.Fatalf("unable to retrieve range from document: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "unable to retrieve range from document:" + err.Error(),
		})
	}

	var players []Player
	for i, cell := range val.Values[0] {
		var eloCell = val.Values[len(val.Values)-1][i]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: parseFloat(eloCell),
		})
	}

	c.JSON(http.StatusOK, players)
}

func AddMatch(c *gin.Context) {
	var payload Match

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	// Get player names from row 1 (C1:Z1)
	headerRange := "Партии!C1:Z1"
	headerResp, err := sheetsService.Spreadsheets.Values.Get(*DocId, headerRange).Do()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to read player headers"})
		return
	}
	playerHeaders := make([]string, 0)
	if len(headerResp.Values) > 0 {
		for _, cell := range headerResp.Values[0] {
			playerHeaders = append(playerHeaders, fmt.Sprintf("%v", cell))
		}
	}

	fmt.Println(playerHeaders)

	// Make a new row to append
	// A - date, B - name of game, C-Z - players score
	row := make([]interface{}, 1+1+len(playerHeaders)) // A+B+players
	row[0] = time.Now().Format("2006-01-02 15:04:05")  // A: дата и время
	row[1] = payload.Game                              // B: name of game
	for i, playerID := range playerHeaders {
		if score, ok := payload.Score[playerID]; ok {
			row[2+i] = score
		} else {
			row[2+i] = ""
		}
	}

	// Append the row to the end of "Партии"
	appendRange := "Партии!A:Z"
	_, err = sheetsService.Spreadsheets.Values.Append(*DocId, appendRange, &sheets.ValueRange{
		Values: [][]interface{}{row},
	}).ValueInputOption("USER_ENTERED").InsertDataOption("OVERWRITE").Do()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to append match: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "match saved"})
}

func parseFloat(val interface{}) float64 {
	switch v := val.(type) {
	case float64:
		return v
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}

func Demo() {
	doc, err := sheetsService.Spreadsheets.Get(*DocId).Do()
	if err != nil {
		log.Fatalf("unable to retrieve data from document: %v", err)
	}

	fmt.Printf("The title of the doc is: %s\n", doc.Properties.Title)

	val, err := sheetsService.Spreadsheets.Values.Get(*DocId, "Rank!A:C").Do()
	if err != nil {
		log.Fatalf("unable to retrieve range from document: %v", err)
	}

	fmt.Printf("Selected major dimension=%v, range=%v\n", val.MajorDimension, val.Range)
	for _, row := range val.Values {
		fmt.Println(row)
	}
}
