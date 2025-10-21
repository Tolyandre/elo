package googlesheet

import (
	"errors"
	"fmt"
	"time"

	"google.golang.org/api/sheets/v4"
)

func parseMatchesSheet() ([]MatchRow, []string, error) {
	matchesResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Партии!A:Z").Do()
	if err != nil {
		return nil, nil, err
	}

	if len(matchesResp.Values) == 0 {
		return nil, nil, errors.New("matches sheet is empty")
	}

	// extract player IDs from header row (columns C..Z)
	playerIDs := parsePlayerIds(matchesResp)

	matches := make([]MatchRow, 0, len(matchesResp.Values))

	// iterate over data rows (starting from second row)
	const averageMaxPlayers = 6
	for rowIndex, row := range matchesResp.Values[1:] {
		m := MatchRow{
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
	return matches, playerIDs, nil
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
		return fmt.Errorf("unable to append match: %v", err.Error())
	}

	parsedDataCache = nil

	return nil
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
