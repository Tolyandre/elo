package googlesheet

import (
	"errors"
	"sync"
	"time"
)

type Settings struct {
	EloConstK float64
	EloConstD float64
}

var (
	settingsCache       *Settings
	settingsCacheMutex  sync.Mutex
	settingsCacheExpiry time.Time
)

func ParseSettings() (*Settings, error) {
	settingsCacheMutex.Lock()
	defer settingsCacheMutex.Unlock()

	if time.Now().Before(settingsCacheExpiry) && settingsCache != nil {
		return settingsCache, nil
	}

	err := parseSettings()
	if err != nil {
		return nil, err
	}

	settingsCacheExpiry = time.Now().Add(4 * time.Hour)

	return settingsCache, nil
}

func parseSettings() error {
	response, err := sheetsService.Spreadsheets.Values.Get(docId, "Elo v2!A1:A7").Do()
	if err != nil {
		return err
	}

	if len(response.Values) == 0 {
		return errors.New("sheet is empty")
	}

	settingsCache = &Settings{
		// Cell A4
		EloConstD: parseFloat(response.Values[3][0]),

		// Cell A7
		EloConstK: parseFloat(response.Values[6][0]),
	}
	return nil
}
