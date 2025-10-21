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

	seen := make(map[string]bool)
	var gameList []string
	for i := len(gamesResp.Values) - 1; i >= 0; i-- {
		row := gamesResp.Values[i]
		if len(row) == 0 {
			continue
		}
		name := fmt.Sprintf("%v", row[0])
		if name == "" {
			continue
		}
		if !seen[name] {
			seen[name] = true
			gameList = append(gameList, name)
		}
	}

	gamesCache = gameList
	gamesCacheExpiry = time.Now().Add(4 * time.Hour)

	return gameList, nil
}
