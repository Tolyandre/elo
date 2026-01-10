package elo

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"time"

	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type Player struct {
	ID                   string
	Elo                  float64
	Rank                 *int
	MatchesLeftForRanked int
}

func GetPlayersWithRank(time *time.Time) ([]Player, error) {
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

const (
	lastMonth  = time.Duration(30 * 24 * time.Hour)
	last3Month = time.Duration(3 * 30 * 24 * time.Hour)
	last6Month = time.Duration(6 * 30 * 24 * time.Hour)
)

var requiredMatchCountForRanked = map[time.Duration]int{
	lastMonth:  1,
	last3Month: 3,
	last6Month: 7,
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

	// Precompute resolved dates for all matches.
	// Matches are sorted by non-decreasing date; nil dates should be resolved
	// to the next non-nil date. If the last match's date is nil, treat it as now.
	matches := parsedData.Matches
	mLen := len(matches)
	resolvedDates := make([]*time.Time, mLen)
	for i := mLen - 1; i >= 0; i-- {
		if matches[i].Date != nil {
			// copy value to avoid aliasing
			t := *matches[i].Date
			resolvedDates[i] = &t
		} else {
			if i == mLen-1 {
				// last match with nil date -> treat as now
				t := time.Now()
				resolvedDates[i] = &t
			} else {
				// forward-fill from next resolved date
				if resolvedDates[i+1] != nil {
					t := *resolvedDates[i+1]
					resolvedDates[i] = &t
				} else {
					// fallback: set to now
					t := time.Now()
					resolvedDates[i] = &t
				}
			}
		}
	}

	// limit rowIndex to available matches when counting
	effectiveRow := rowIndex
	if effectiveRow < 0 {
		effectiveRow = 0
	}
	if effectiveRow >= mLen {
		effectiveRow = mLen - 1
	}

	// reference date for counting is resolved date at effectiveRow
	var refDate *time.Time
	if mLen > 0 {
		refDate = resolvedDates[effectiveRow]
	}

	// Precompute max required for fallback when no refDate
	maxRequired := 0
	for _, req := range requiredMatchCountForRanked {
		if req > maxRequired {
			maxRequired = req
		}
	}

	for pi := range players {
		id := players[pi].ID

		if refDate == nil {
			players[pi].MatchesLeftForRanked = maxRequired
			players[pi].Rank = nil
			continue
		}

		maxDeficit := 0
		// For each requirement window, use binary search to find earliest index >= windowStart
		for duration, required := range requiredMatchCountForRanked {
			windowStart := refDate.Add(-duration)

			// find first index with resolvedDates[idx] >= windowStart
			startIdx := sort.Search(mLen, func(i int) bool {
				return !resolvedDates[i].Before(windowStart)
			})

			// ensure startIdx is within bounds and not after effectiveRow
			if startIdx < 0 {
				startIdx = 0
			}
			if startIdx > effectiveRow {
				// no matches in window
				deficit := required
				if deficit > maxDeficit {
					maxDeficit = deficit
				}
				continue
			}

			// count appearances of player id from startIdx..effectiveRow
			count := 0
			for mi := startIdx; mi <= effectiveRow; mi++ {
				if _, ok := matches[mi].PlayersScore[id]; ok {
					count++
				}
			}

			deficit := required - count
			if deficit > maxDeficit {
				maxDeficit = deficit
			}
		}

		if maxDeficit < 0 {
			maxDeficit = 0
		}
		players[pi].MatchesLeftForRanked = maxDeficit
		players[pi].Rank = nil
	}

	// Assign ranks only among players who meet the match requirements.
	// Keep competition-style ranking: tied rounded Elos share the same rank and cause skips.
	eligibleIndex := 0
	var prevEligibleRoundElo float64 = math.NaN()
	var prevEligibleRank *int

	for i := range players {
		if players[i].MatchesLeftForRanked > 0 {
			// Not eligible for ranking
			players[i].Rank = nil
			continue
		}

		rounded := math.Round(players[i].Elo)
		if !math.IsNaN(prevEligibleRoundElo) && rounded == prevEligibleRoundElo {
			players[i].Rank = prevEligibleRank
		} else {
			r := eligibleIndex + 1
			players[i].Rank = &r
			prevEligibleRank = players[i].Rank
			prevEligibleRoundElo = rounded
		}
		eligibleIndex++
	}

	return players
}
