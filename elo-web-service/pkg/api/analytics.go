package api

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	elopkg "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/jackc/pgx/v5/pgtype"
)

const eloResetMaxPoints = 100

func (s *StrictServer) GetEloReset(ctx context.Context, request GetEloResetRequestObject) (GetEloResetResponseObject, error) {
	selectedSet := map[int32]bool{}
	var playerIDs []int32
	for _, s := range request.Params.PlayerId {
		id, err := strconv.Atoi(s)
		if err != nil || id <= 0 {
			return GetEloReset400JSONResponse{Status: "fail", Message: fmt.Sprintf("invalid player_id: %s", s)}, nil
		}
		pid := int32(id)
		if !selectedSet[pid] {
			selectedSet[pid] = true
			playerIDs = append(playerIDs, pid)
		}
	}
	if len(playerIDs) == 0 {
		return GetEloReset400JSONResponse{Status: "fail", Message: "player_id required"}, nil
	}

	calcDate := time.Now().UTC()
	if request.Params.CalcDate != nil {
		calcDate = request.Params.CalcDate.UTC()
	}

	rows, err := s.api.Queries.ListMatchesForEloReset(ctx, pgtype.Timestamptz{Time: calcDate, Valid: true})
	if err != nil {
		return nil, err
	}

	type matchEntry struct {
		matchID      int32
		date         time.Time
		rows         []db.ListMatchesForEloResetRow
		hasSelPlayer bool
	}
	var matchOrder []int32
	matchByID := map[int32]*matchEntry{}
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
		return GetEloReset200JSONResponse{Status: "success", Data: EloResetResult{
			Series:  []EloResetSeriesPoint{},
			Players: []EloResetPlayerInfo{},
		}}, nil
	}

	firstDate := relevant[0].date
	duration := calcDate.Sub(firstDate)
	N := eloResetMaxPoints
	if N > len(relevant) {
		N = len(relevant)
	}

	var series []EloResetSeriesPoint
	for i := 0; i < N; i++ {
		var resetPoint time.Time
		if N == 1 {
			resetPoint = firstDate
		} else {
			resetPoint = firstDate.Add(time.Duration(float64(duration) * float64(i) / float64(N-1)))
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
			hypElos[strconv.Itoa(int(pid))] = startingElo
		}

		for _, m := range relevant {
			if m.date.Before(resetPoint) {
				continue
			}
			prevEloStr := map[string]float64{}
			scoresStr := map[string]float64{}
			fr := m.rows[0]
			for _, row := range m.rows {
				pid := strconv.Itoa(int(row.PlayerID))
				scoresStr[pid] = row.Score
				if selectedSet[row.PlayerID] {
					prevEloStr[pid] = hypElos[pid]
				} else if row.PrevGlobalElo != nil {
					if v, ok := row.PrevGlobalElo.(float64); ok {
						prevEloStr[pid] = v
					}
				}
			}
			newElos := elopkg.CalculateNewElo(prevEloStr, fr.StartingElo, scoresStr, fr.EloConstK, fr.EloConstD, fr.WinReward)
			for _, row := range m.rows {
				if selectedSet[row.PlayerID] {
					pid := strconv.Itoa(int(row.PlayerID))
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

	seen := map[int32]bool{}
	var players []EloResetPlayerInfo
	for _, row := range rows {
		if selectedSet[row.PlayerID] && !seen[row.PlayerID] {
			seen[row.PlayerID] = true
			players = append(players, EloResetPlayerInfo{
				Id:   strconv.Itoa(int(row.PlayerID)),
				Name: row.PlayerName,
			})
		}
	}
	return GetEloReset200JSONResponse{Status: "success", Data: EloResetResult{Series: series, Players: players}}, nil
}
