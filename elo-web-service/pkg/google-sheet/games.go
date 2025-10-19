package googlesheet

import (
	"fmt"
	"sync"
	"time"
)

var (
	gamesCache       []string
	gamesCacheMutex  sync.Mutex
	gamesCacheExpiry time.Time
)

func GetGames() ([]string, error) {
	gamesCacheMutex.Lock()
	defer gamesCacheMutex.Unlock()

	if time.Now().Before(gamesCacheExpiry) && gamesCache != nil {
		return gamesCache, nil
	}

	gamesResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Партии!B2:B").Do()
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve games: %v", err)
	}

	games := make(map[string]bool)
	for _, row := range gamesResp.Values {
		if len(row) > 0 {
			games[fmt.Sprintf("%v", row[0])] = true
		}
	}
	var gameList []string
	for key := range games {
		gameList = append(gameList, key)
	}

	gamesCache = gameList
	gamesCacheExpiry = time.Now().Add(4 * time.Hour)

	return gameList, nil
}
