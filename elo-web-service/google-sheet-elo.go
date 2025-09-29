package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type Player struct {
	ID  string  `json:"id"`
	Elo float64 `json:"elo"`
}

var sheetsService *sheets.Service

func InitGoogleSheetsService() {
	ctx := context.Background()
	credentials, err := ioutil.ReadFile(*KeyFilePath)
	if err != nil {
		log.Fatal("unable to read key file:", err)
	}

	scopes := []string{
		"https://www.googleapis.com/auth/spreadsheets.readonly",
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
	}

	var players []Player
	for i, cell := range val.Values[0] {
		var eloCell = val.Values[len(val.Values)-1][i]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: parseFloat(eloCell),
		})
	}

	c.IndentedJSON(http.StatusOK, players)
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
