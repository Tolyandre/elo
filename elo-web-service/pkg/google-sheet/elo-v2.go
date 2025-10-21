package googlesheet

import (
	"errors"
	"fmt"
)

func parseEloSheet() ([]EloRow, error) {
	eloResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Elo v2!A:Z").Do()
	if err != nil {
		return nil, err
	}

	if len(eloResp.Values) == 0 {
		return nil, errors.New("sheet is empty")
	}

	// extract player IDs from header row (columns C..Z)
	playerIDs := parsePlayerIds(eloResp)

	elo := make([]EloRow, 0, len(eloResp.Values))

	// iterate over data rows (starting from second row)
	for rowIndex, row := range eloResp.Values[1:] {
		m := EloRow{
			RowNum:     rowIndex + 2, // spreadsheet row number (header is row 1)
			PlayersElo: make(map[string]float64, len(playerIDs)),
		}

		// Skip Columns A and B

		// Players score columns C..
		for i, pid := range playerIDs {
			colIdx := 2 + i
			if colIdx < len(row) {
				cell := row[colIdx]
				score := parseFloat(cell)
				m.PlayersElo[pid] = score

			}
		}

		elo = append(elo, m)
	}
	return elo, nil
}

func ParsePlayersAndElo() ([]Player, error) {
	parsedData, err := GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	var players []Player
	for _, cell := range parsedData.PlayerIds {
		var eloCell = parsedData.Elo[len(parsedData.Elo)-1].PlayersElo[cell]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: parseFloat(eloCell),
		})
	}
	return players, nil
}

// eloRows must be ordered; first row number 2 has index 0 (first row is header)
func Elo(eloRows []EloRow, rowNum int) *EloRow {
	return &eloRows[rowNum-2]
}
