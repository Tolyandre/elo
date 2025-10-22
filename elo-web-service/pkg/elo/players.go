package googlesheet

import (
	"fmt"
	"math"
	"slices"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type Player struct {
	ID   string
	Elo  float64
	Rank int
}

func GetPlayersWithElo() ([]Player, error) {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	var players []Player
	for _, cell := range parsedData.PlayerIds {
		var eloCell = parsedData.Elo[len(parsedData.Elo)-1].PlayersElo[cell]

		players = append(players, Player{
			ID:  fmt.Sprintf("%v", cell),
			Elo: eloCell,
		})
	}

	slices.SortFunc(players, func(a, b Player) int {
		return int(b.Elo - a.Elo)
	})

	for i := range players {
		if i > 0 && math.Round(players[i].Elo) == math.Round(players[i-1].Elo) {
			players[i].Rank = players[i-1].Rank
		} else {
			players[i].Rank = i + 1
		}
	}

	return players, nil
}
