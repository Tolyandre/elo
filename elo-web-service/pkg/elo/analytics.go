package elo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// EloResetMaxPoints caps how many points the client-side chart draws for an
// elo-reset series.
const EloResetMaxPoints = 100

// EloResetSeriesPoint is one sampled point of a hypothetical elo-reset chart:
// the date the reset is computed from, plus the resulting per-player ratings.
type EloResetSeriesPoint struct {
	ResetDate time.Time
	Players   map[string]float64
}

// EloResetPlayerInfo carries the display identity of a selected player.
type EloResetPlayerInfo struct {
	ID   string
	Name string
}

// EloResetResult is the domain shape returned by ComputeEloReset. The API layer
// maps this onto the generated response model.
type EloResetResult struct {
	Series  []EloResetSeriesPoint
	Players []EloResetPlayerInfo
}

// matchEntry groups the per-player rows of a single match during a reset.
type matchEntry struct {
	matchID      string
	date         time.Time
	rows         []db.ListMatchesForEloResetRow
	hasSelPlayer bool
}

// ComputeEloReset replays the match history for the given selected players,
// sampling EloResetMaxPoints reset dates between the first relevant match and
// calcDate. For each sample it re-runs CalculateNewElo from scratch using the
// selected players' hypothetical ratings and the historical ratings of everyone
// else. The DB access (ListMatchesForEloReset) is the caller's concern so this
// stays unit-testable in isolation; callers pass the rows in.
//
// The math here was previously inline in pkg/api/analytics.go's GetEloReset
// handler (a 131-line function mixing DB access, replay, and response shaping).
func ComputeEloReset(rows []db.ListMatchesForEloResetRow, selectedPlayerIDs []string, calcDate time.Time) EloResetResult {
	selectedSet := map[string]bool{}
	var playerIDs []string
	for _, pid := range selectedPlayerIDs {
		if !selectedSet[pid] {
			selectedSet[pid] = true
			playerIDs = append(playerIDs, pid)
		}
	}

	var matchOrder []string
	matchByID := map[string]*matchEntry{}
	for _, row := range rows {
		if _, ok := matchByID[row.MatchID]; !ok {
			matchByID[row.MatchID] = &matchEntry{matchID: row.MatchID, date: row.Date.Time}
			matchOrder = append(matchOrder, row.MatchID)
		}
		me := matchByID[row.MatchID]
		me.rows = append(me.rows, row)
		if selectedSet[row.PlayerID] {
			me.hasSelPlayer = true
		}
	}

	var relevant []*matchEntry
	for _, mid := range matchOrder {
		if matchByID[mid].hasSelPlayer {
			relevant = append(relevant, matchByID[mid])
		}
	}
	if len(relevant) == 0 {
		return EloResetResult{Series: []EloResetSeriesPoint{}, Players: []EloResetPlayerInfo{}}
	}

	firstDate := relevant[0].date
	duration := calcDate.Sub(firstDate)
	n := EloResetMaxPoints
	if n > len(relevant) {
		n = len(relevant)
	}

	var series []EloResetSeriesPoint
	for i := 0; i < n; i++ {
		var resetPoint time.Time
		if n == 1 {
			resetPoint = firstDate
		} else {
			resetPoint = firstDate.Add(time.Duration(float64(duration) * float64(i) / float64(n-1)))
		}

		startingElo := 1000.0
		for _, m := range relevant {
			if !m.date.Before(resetPoint) {
				startingElo = m.rows[0].StartingElo
				break
			}
		}

		hypElos := map[string]float64{}
		for _, pid := range playerIDs {
			hypElos[pid] = startingElo
		}

		for _, m := range relevant {
			if m.date.Before(resetPoint) {
				continue
			}
			prevEloStr := map[string]float64{}
			scoresStr := map[string]float64{}
			fr := m.rows[0]
			for _, row := range m.rows {
				pid := row.PlayerID
				scoresStr[pid] = row.Score
				if selectedSet[row.PlayerID] {
					prevEloStr[pid] = hypElos[pid]
				} else if row.PrevGlobalElo != nil {
					if v, ok := row.PrevGlobalElo.(float64); ok {
						prevEloStr[pid] = v
					}
				}
			}
			newElos := CalculateNewElo(prevEloStr, fr.StartingElo, scoresStr, fr.EloConstK, fr.EloConstD, fr.WinReward)
			for _, row := range m.rows {
				if selectedSet[row.PlayerID] {
					pid := row.PlayerID
					hypElos[pid] = newElos[pid]
				}
			}
		}

		snap := make(map[string]float64, len(hypElos))
		for k, v := range hypElos {
			snap[k] = v
		}
		series = append(series, EloResetSeriesPoint{ResetDate: resetPoint.UTC(), Players: snap})
	}

	seen := map[string]bool{}
	var players []EloResetPlayerInfo
	for _, row := range rows {
		if selectedSet[row.PlayerID] && !seen[row.PlayerID] {
			seen[row.PlayerID] = true
			players = append(players, EloResetPlayerInfo{ID: row.PlayerID, Name: row.PlayerName})
		}
	}
	return EloResetResult{Series: series, Players: players}
}

// ListMatchesForEloReset wraps the raw query so the API handler does not call
// *db.Queries directly. It lives on MatchService to keep the analytics read
// behind the service boundary (consistent with RatingHistory).
func (s *MatchService) ListMatchesForEloReset(ctx context.Context, calcDate time.Time) ([]db.ListMatchesForEloResetRow, error) {
	return s.Queries.ListMatchesForEloReset(ctx, pgtype.Timestamptz{Time: calcDate, Valid: true})
}

// ListMatchesWithPlayersPaginated is the paginated match-list read for the
// ListMatches handler.
func (s *MatchService) ListMatchesWithPlayersPaginated(ctx context.Context, arg db.ListMatchesWithPlayersPaginatedParams) ([]db.ListMatchesWithPlayersPaginatedRow, error) {
	return s.Queries.ListMatchesWithPlayersPaginated(ctx, arg)
}

// GetMatchWithPlayers is the single-match read for the GetMatchById handler.
func (s *MatchService) GetMatchWithPlayers(ctx context.Context, id string) ([]db.GetMatchWithPlayersRow, error) {
	return s.Queries.GetMatchWithPlayers(ctx, id)
}

// ListTournamentsByMatchIDs returns the tournament memberships for a set of
// matches; used by both the list and detail handlers.
func (s *MatchService) ListTournamentsByMatchIDs(ctx context.Context, matchIDs []string) ([]db.ListTournamentsByMatchIDsRow, error) {
	return s.Queries.ListTournamentsByMatchIDs(ctx, matchIDs)
}
