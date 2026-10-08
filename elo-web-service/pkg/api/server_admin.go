package api

import (
	"context"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) UpdateArenas(ctx context.Context, _ UpdateArenasRequestObject) (UpdateArenasResponseObject, error) {
	// Every arena: match settlements per arena, then one market-ledger sweep,
	// with the per-arena before/after diff across the whole recalculation.
	reports, err := s.api.ArenaService.RecalculateAllArenas(ctx)
	if err != nil {
		// A moved market resolution can hit the same history-conflict guard
		// the edit+save flow uses; surface it as a real status, not a 500.
		if domainStatusCode(err) == http.StatusConflict {
			return UpdateArenas409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}

	changedToAPI := func(changes []elo.PlayerStateChange) []PlayerStateChange {
		out := make([]PlayerStateChange, len(changes))
		for i, c := range changes {
			out[i] = PlayerStateChange{
				PlayerId:     c.PlayerID,
				PlayerName:   c.PlayerName,
				EloBefore:    c.EloBefore,
				EloAfter:     c.EloAfter,
				RatingBefore: c.RatingBefore,
				RatingAfter:  c.RatingAfter,
				LeagueBefore: c.LeagueBefore,
				LeagueAfter:  c.LeagueAfter,
			}
		}
		return out
	}

	arenaReports := make([]ArenaUpdateReport, 0, len(reports))
	settlementsReplayed := int64(0)
	for _, r := range reports {
		settlementsReplayed += int64(r.MatchesReplayed)
		arenaReports = append(arenaReports, ArenaUpdateReport{
			ArenaId:         Base58ID(r.ArenaID),
			ArenaName:       r.ArenaName,
			MatchesReplayed: int64(r.MatchesReplayed),
			ChangedPlayers:  changedToAPI(r.ChangedPlayers),
		})
	}

	// The replays rewrite every settlement — all connected clients are stale.
	s.api.broadcastDataChange(true, true)
	s.api.Hub.PublishSignal(elo.TopicData, "arenas-changed")

	return UpdateArenas200JSONResponse{
		Status: StatusSuccess,
		Data: struct {
			Arenas              []ArenaUpdateReport `json:"arenas"`
			SettlementsReplayed int64               `json:"settlements_replayed"`
		}{
			Arenas:              arenaReports,
			SettlementsReplayed: settlementsReplayed,
		},
	}, nil
}
