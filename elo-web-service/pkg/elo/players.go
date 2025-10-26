package googlesheet

import (
	"fmt"
	"math"
	"slices"
	"time"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type Player struct {
	ID   string
	Elo  float64
	Rank int
}

func GetPlayersWithElo(time *time.Time) ([]Player, error) {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	var lastRowIndex int
	if time == nil {
		lastRowIndex = len(parsedData.Elo) - 1
	} else {
		lastRowIndex = getRowIndexForDate(parsedData, *time)
	}

	return getPlayersForRowNum(parsedData, lastRowIndex), nil
}

// elo at a specified time moment is elo of a previous game
func getRowIndexForDate(parsedData *googlesheet.ParsedData, date time.Time) int {
	for i := len(parsedData.Matches) - 1; i >= 0; i-- {
		if parsedData.Matches[i].Date != nil {
			if parsedData.Matches[i].Date.After(date) {
				continue
			}

			return i
		}
	}
	return 0
}

func getPlayersForRowNum(parsedData *googlesheet.ParsedData, rowIndex int) []Player {
	players := make([]Player, 0, len(parsedData.PlayerIds))
	for _, cell := range parsedData.PlayerIds {
		var eloCell = parsedData.Elo[rowIndex].PlayersElo[cell]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: eloCell,
		})
	}

	slices.SortFunc(players, func(a, b Player) int {
		if b.Elo-a.Elo > 0 {
			return 1
		}
		if b.Elo-a.Elo < 0 {
			return -1
		}
		return 0
	})

	for i := range players {
		if i > 0 && math.Round(players[i].Elo) == math.Round(players[i-1].Elo) {
			players[i].Rank = players[i-1].Rank
		} else {
			players[i].Rank = i + 1
		}
	}
	return players
}
