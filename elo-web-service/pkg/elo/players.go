package googlesheet

import (
	"fmt"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type Player struct {
	ID  string
	Elo float64
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
	return players, nil
}
