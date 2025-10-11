package googlesheet

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type Player struct {
	ID  string
	Elo float64
}

type matchRow struct {
	RowNum       int
	Date         *time.Time
	Game         string
	PlayersScore map[string]float64
}

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

func ParseMatchesSheet() ([]matchRow, error) {
	matchesResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Партии!A:Z").Do()
	if err != nil {
		return nil, err
	}

	if len(matchesResp.Values) == 0 {
		return nil, errors.New("sheet is empty")
	}

	// extract player IDs from header row (columns C..Z)
	playerIDs := parsePlayerIds(matchesResp)

	matches := make([]matchRow, 0, len(matchesResp.Values))

	// iterate over data rows (starting from second row)
	const averageMaxPlayers = 6
	for rowIndex, row := range matchesResp.Values[1:] {
		m := matchRow{
			RowNum:       rowIndex + 2, // spreadsheet row number (header is row 1)
			PlayersScore: make(map[string]float64, averageMaxPlayers),
		}

		// Date (column A) - best-effort parsing
		if len(row) > 0 {
			m.Date = parseCellDate(row[0])
		}

		// Game (column B)
		if len(row) > 1 {
			m.Game = fmt.Sprintf("%v", row[1])
		}

		// Players columns C.. - include only when cell non-empty
		for i, pid := range playerIDs {
			colIdx := 2 + i
			if colIdx < len(row) {
				cell := row[colIdx]
				score := parseFloatOrNil(cell)
				if score != nil {
					m.PlayersScore[pid] = *score
				}
			}
		}

		matches = append(matches, m)
	}
	return matches, nil
}

func parsePlayerIds(matchesResp *sheets.ValueRange) []string {
	headerRow := matchesResp.Values[0]
	playerIDs := make([]string, 0, len(matchesResp.Values[0]))
	if len(headerRow) > 2 {
		for _, cell := range headerRow[2:] {
			id := fmt.Sprintf("%v", cell)
			if id != "" {
				playerIDs = append(playerIDs, id)
			}
		}
	}
	return playerIDs
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

func ParsePlayersAndElo() ([]Player, error) {
	val, err := sheetsService.Spreadsheets.Values.Get(docId, "Elo v2!C1:500").Do()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve range from document: %v", err)
	}

	var players []Player
	for i, cell := range val.Values[0] {
		var eloCell = val.Values[len(val.Values)-1][i]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: parseFloat(eloCell),
		})
	}
	return players, nil
}

func AddMatch(game string, score map[string]float64) error {
	headerRange := "Партии!C1:Z1"
	headerResp, err := sheetsService.Spreadsheets.Values.Get(docId, headerRange).Do()
	if err != nil {
		return fmt.Errorf("unable to read player headers")
	}
	playerHeaders := make([]string, 0)
	if len(headerResp.Values) > 0 {
		for _, cell := range headerResp.Values[0] {
			playerHeaders = append(playerHeaders, fmt.Sprintf("%v", cell))
		}
	}

	// Make a new row to append
	// A - date, B - name of game, C-Z - players score
	row := make([]interface{}, 1+1+len(playerHeaders)) // A+B+players
	row[0] = time.Now().Format("2006-01-02 15:04:05")  // A: дата и время
	row[1] = game                                      // B: name of game
	for i, playerID := range playerHeaders {
		if score, ok := score[playerID]; ok {
			row[2+i] = score
		} else {
			row[2+i] = ""
		}
	}

	// Append the row to the end of "Партии"
	appendRange := "Партии!A:Z"
	_, err = sheetsService.Spreadsheets.Values.Append(docId, appendRange, &sheets.ValueRange{
		Values: [][]interface{}{row},
	}).ValueInputOption("USER_ENTERED").InsertDataOption("OVERWRITE").Do()
	if err != nil {
		//c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to append match: " + err.Error()})
		return fmt.Errorf("unable to append match: %v", err.Error())
	}

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

// parseMatchCell parses cell text like "1041 ↑ 2 (-10 +12)" or "1041 ↓ -3 (-8 +5)"
// Returns (score, eloPay, eloEarn). If a part can't be parsed, it will be 0.
func parseMatchCell(val interface{}) (float64, float64, float64) {
	s := strings.TrimSpace(fmt.Sprintf("%v", val))
	if s == "" {
		return 0, 0, 0
	}

	// find numbers inside parentheses: e.g. (-10 +12)
	parenRe := regexp.MustCompile(`\((-?\d+)\s+([+-]?\d+)\)`)
	pay := 0.0
	earn := 0.0
	if m := parenRe.FindStringSubmatch(s); len(m) == 3 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			pay = v
		}
		if v2, err2 := strconv.ParseFloat(m[2], 64); err2 == nil {
			earn = v2
		}
	}

	// find score number after arrow ↑ or ↓, e.g. "↑ 2" or "↓ -3"
	scoreRe := regexp.MustCompile(`[↑↓]\s*([+-]?\d+)`)
	score := 0.0
	if m := scoreRe.FindStringSubmatch(s); len(m) == 2 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			score = v
		}
	} else {
		// fallback: try to find first standalone number (could be leading 1041) - prefer the small one after arrow but if absent, try any number
		anyRe := regexp.MustCompile(`([+-]?\d+)`)
		nums := anyRe.FindAllString(s, -1)
		if len(nums) > 0 {
			// if there are multiple numbers, try to pick the one that is not 4-digit (heuristic)
			chosen := nums[len(nums)-1]
			for _, n := range nums {
				if len(n) <= 3 {
					chosen = n
					break
				}
			}
			if v, err := strconv.ParseFloat(chosen, 64); err == nil {
				score = v
			}
		}
	}

	return score, pay, earn
}
