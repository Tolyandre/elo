package googlesheet

import (
	"fmt"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type GameStatistics struct {
	Id           string
	TotalMatches int
}

func GetGameTitlesOrderedByLastPlayed() ([]string, error) {

	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	seen := make(map[string]bool)
	var gameList []string
	for i := len(parsedData.Matches) - 1; i >= 0; i-- {
		row := parsedData.Matches[i]
		if len(row.PlayersScore) == 0 {
			continue
		}
		name := row.Game
		if name == "" {
			continue
		}
		if !seen[name] {
			seen[name] = true
			gameList = append(gameList, name)
		}
	}

	return gameList, nil
}

func GetGameStatistics(id string) (*GameStatistics, error) {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve parsed data: %v", err)
	}

	var totalMatches int = 0
	for _, match := range parsedData.Matches {
		if match.Game == id {
			totalMatches++
		}
	}

	return &GameStatistics{
		Id:           id,
		TotalMatches: totalMatches,
	}, nil
}
