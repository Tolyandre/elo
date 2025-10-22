package googlesheet

import (
	"context"
	"sync"

	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type MatchRow struct {
	RowNum       int
	Date         *time.Time
	Game         string
	PlayersScore map[string]float64
}

type EloRow struct {
	RowNum     int
	PlayersElo map[string]float64
}

type Settings struct {
	EloConstK float64
	EloConstD float64
}

type ParsedData struct {
	Elo       []EloRow
	Matches   []MatchRow
	PlayerIds []string
	Settings  Settings
}

var (
	parsedDataCache       *ParsedData
	parsedDataCacheMutex  sync.Mutex
	parsedDataCacheExpiry time.Time
)

var sheetsService *sheets.Service
var docId string

func Init(googleServiceAccountKeyPath string, doc_Id string) {
	docId = doc_Id

	ctx := context.Background()
	credentials, err := os.ReadFile(googleServiceAccountKeyPath)
	if err != nil {
		log.Fatal("unable to read key file:", err)
		os.Exit(1)
	}

	scopes := []string{
		"https://www.googleapis.com/auth/spreadsheets",
	}
	serviceAccountConfig, err := google.JWTConfigFromJSON(credentials, scopes...)
	if err != nil {
		log.Fatal("unable to create JWT configuration:", err)
		os.Exit(1)
	}

	sheetsService, err = sheets.NewService(ctx, option.WithHTTPClient(serviceAccountConfig.Client(ctx)))
	if err != nil {
		log.Fatalf("unable to retrieve sheets service: %v", err)
		os.Exit(1)
	}
}

func GetParsedData() (*ParsedData, error) {
	parsedDataCacheMutex.Lock()
	defer parsedDataCacheMutex.Unlock()

	if time.Now().Before(parsedDataCacheExpiry) && parsedDataCache != nil {
		return parsedDataCache, nil
	}

	matchRow, playerIds, err := parseMatchesSheet()
	if err != nil {
		return nil, err
	}

	eloRows, settings, err := parseEloSheet()
	if err != nil {
		return nil, err
	}

	parsedDataCache = &ParsedData{
		Settings:  *settings,
		Matches:   matchRow,
		Elo:       eloRows,
		PlayerIds: playerIds,
	}

	parsedDataCacheExpiry = time.Now().Add(2 * time.Minute)

	return parsedDataCache, nil
}

func parseCellDate(cell interface{}) *time.Time {
	raw := fmt.Sprintf("%v", cell)
	if raw != "" {
		// try the format used by AddMatch first
		if t, err := time.Parse("2006-01-02 15:04:05", raw); err == nil {
			return &t
		} else if t2, err2 := time.Parse(time.RFC3339, raw); err2 == nil {
			return &t2
		}
	}
	// could not parse - leave nil (placeholder)
	return nil
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

func parseFloatOrNil(val interface{}) *float64 {
	switch v := val.(type) {
	case float64:
		return &v
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil
		}
		return &f
	default:
		return nil
	}
}
