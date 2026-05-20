package api

import (
	"context"
	"strconv"
)

func (s *StrictServer) CreatePlayerCorrection(ctx context.Context, request CreatePlayerCorrectionRequestObject) (CreatePlayerCorrectionResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, nil
	}

	if _, err := MustGetCurrentUser(ginCtx, s.api.UserService); err != nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "authentication required"}, nil
	}

	playerID, err := strconv.Atoi(request.Id)
	if err != nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "invalid player id"}, nil
	}

	if request.Body == nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "request body required"}, nil
	}

	if err := s.api.CorrectionService.CreateGlobalArenaRatingCorrection(ctx, int32(playerID), float64(request.Body.Diff)); err != nil {
		return nil, err
	}

	return CreatePlayerCorrection200JSONResponse{Status: "success", Message: "Correction applied"}, nil
}
