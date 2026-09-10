package api

import (
	"context"
)

func (s *StrictServer) GetPing(_ context.Context, _ GetPingRequestObject) (GetPingResponseObject, error) {
	return GetPing200JSONResponse{Status: "success", Message: "pong"}, nil
}
