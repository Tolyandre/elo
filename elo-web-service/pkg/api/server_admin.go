package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) UpdateArenas(ctx context.Context, _ UpdateArenasRequestObject) (UpdateArenasResponseObject, error) {
	// Global arena: exact-replay with the player-state diff.
	report, err := s.api.MatchService.RecalculateAllGlobalElo(ctx)
	if err != nil {
		// A moved market resolution can hit the same history-conflict guard
		// the edit+save flow uses; surface it as a real status, not a 500.
		if domainStatusCode(err) == http.StatusConflict {
			return UpdateArenas409JSONResponse{Status: "fail", Message: err.Error()}, nil
		}
		return nil, err
	}

	// Every other arena: full replay of its filtered matches.
	reports, err := s.api.ArenaService.RecalculateArenas(ctx)
	if err != nil {
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
	for _, r := range reports {
		arenaReports = append(arenaReports, ArenaUpdateReport{
			ArenaId:         Base58ID(r.ArenaID),
			ArenaName:       r.ArenaName,
			MatchesReplayed: int64(r.MatchesReplayed),
			ChangedPlayers:  changedToAPI(r.ChangedPlayers),
		})
	}

	// The replays rewrite every settlement — all connected clients are stale.
	s.api.broadcastDataChange(true, true)

	return UpdateArenas200JSONResponse{
		Status: "success",
		Data: struct {
			Arenas []ArenaUpdateReport `json:"arenas"`
			Global GlobalReplayReport  `json:"global"`
		}{
			Global: GlobalReplayReport{
				MatchesReplayed:     int64(report.MatchesReplayed),
				CorrectionsReplayed: int64(report.CorrectionsReplayed),
				ChangedPlayers:      changedToAPI(report.ChangedPlayers),
			},
			Arenas: arenaReports,
		},
	}, nil
}

func (s *StrictServer) CreatePlayerCorrection(ctx context.Context, request CreatePlayerCorrectionRequestObject) (CreatePlayerCorrectionResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		// Previously this returned (nil, nil), silently dropping the failure as a
		// 200 with an empty body. Surface it as a real internal error instead.
		return nil, fmt.Errorf("gin context not available")
	}

	if _, err := MustGetCurrentUser(ginCtx, s.api.UserService); err != nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "authentication required"}, nil
	}

	if request.Body == nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "request body required"}, nil
	}

	if err := s.api.CorrectionService.CreateGlobalArenaRatingCorrection(ctx, request.Body.Id, parseIDParam(request.Id), float64(request.Body.Diff)); err != nil {
		return nil, err
	}

	// Corrections shift ratings and appear in the matches timeline.
	s.api.broadcastDataChange(true, true)

	return CreatePlayerCorrection200JSONResponse{Status: "success", Message: "Correction applied"}, nil
}
