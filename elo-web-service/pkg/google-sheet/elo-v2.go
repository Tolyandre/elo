package googlesheet

import (
	"errors"

	"google.golang.org/api/sheets/v4"
)

func parseEloSheet() ([]EloRow, *Settings, error) {
	eloResponse, err := sheetsService.Spreadsheets.Values.
		Get(docId, "Elo v2!A:Z").
		ValueRenderOption("UNFORMATTED_VALUE").
		Do()

	if err != nil {
		return nil, nil, err
	}

	if len(eloResponse.Values) == 0 {
		return nil, nil, errors.New("sheet is empty")
	}

	// extract player IDs from header row (columns C..Z)
	playerIDs := parsePlayerIds(eloResponse)

	elo := make([]EloRow, 0, len(eloResponse.Values))

	// iterate over data rows (starting from second row)
	for rowIndex, row := range eloResponse.Values[1:] {
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
	return elo, parseSettings(eloResponse), nil
}

func parseSettings(eloResponse *sheets.ValueRange) *Settings {
	return &Settings{
		// Cell A4
		EloConstD: parseFloat(eloResponse.Values[3][0]),

		// Cell A7
		EloConstK: parseFloat(eloResponse.Values[6][0]),
	}
}
