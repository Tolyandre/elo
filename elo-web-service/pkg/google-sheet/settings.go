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
	settingsCache *Settings
	cacheMutex    sync.Mutex
	cacheExpiry   time.Time
)

func ParseSettings() (*Settings, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	if time.Now().Before(cacheExpiry) && settingsCache != nil {
		return settingsCache, nil
	}

	err := parse()
	if err != nil {
		return nil, err
	}

	cacheExpiry = time.Now().Add(4 * time.Hour)

	return settingsCache, nil
}

func parse() error {
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
