package api

import (
	"context"
	"fmt"
	"net/http"
)

func (s *StrictServer) RecalculateGlobalElo(ctx context.Context, _ RecalculateGlobalEloRequestObject) (RecalculateGlobalEloResponseObject, error) {
	report, err := s.api.MatchService.RecalculateAllGlobalElo(ctx)
	if err != nil {
		// A moved market resolution can hit the same history-conflict guard
		// the edit+save flow uses; surface it as a real status, not a 500.
		if domainStatusCode(err) == http.StatusConflict {
			return RecalculateGlobalElo409JSONResponse{Status: "fail", Message: err.Error()}, nil
		}
		return nil, err
	}

	changes := make([]PlayerGlobalStateChange, len(report.ChangedPlayers))
	for i, c := range report.ChangedPlayers {
		changes[i] = PlayerGlobalStateChange{
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

	// The replay rewrites every settlement — all connected clients are stale.
	s.api.broadcastDataChange(true, true)

	return RecalculateGlobalElo200JSONResponse{
		Status: "success",
		Data: GlobalReplayReport{
			MatchesReplayed:     int64(report.MatchesReplayed),
			CorrectionsReplayed: int64(report.CorrectionsReplayed),
			ChangedPlayers:      changes,
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
