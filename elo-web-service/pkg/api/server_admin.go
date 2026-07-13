package api

import (
	"context"
)

func (s *StrictServer) CreatePlayerCorrection(ctx context.Context, request CreatePlayerCorrectionRequestObject) (CreatePlayerCorrectionResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, nil
	}

	if _, err := MustGetCurrentUser(ginCtx, s.api.UserService); err != nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "authentication required"}, nil
	}

	if request.Body == nil {
		return CreatePlayerCorrection400JSONResponse{Status: "fail", Message: "request body required"}, nil
	}

	if err := s.api.CorrectionService.CreateGlobalArenaRatingCorrection(ctx, request.Body.Id, request.Id, float64(request.Body.Diff)); err != nil {
		return nil, err
	}

	return CreatePlayerCorrection200JSONResponse{Status: "success", Message: "Correction applied"}, nil
}
