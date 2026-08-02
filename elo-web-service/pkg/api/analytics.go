package api

import (
	"context"
	"time"

	elopkg "github.com/tolyandre/elo-web-service/pkg/elo"
)

// GetEloReset is a thin adapter: the replay math and DB read live in pkg/elo
// (MatchService.ListMatchesForEloReset + ComputeEloReset), so this handler only
// validates input, invokes the service, and maps the domain result onto the
// generated response model. It used to be a 131-line function that mixed DB
// access, the Elo replay, and response shaping.
func (s *StrictServer) GetEloReset(ctx context.Context, request GetEloResetRequestObject) (GetEloResetResponseObject, error) {
	if len(request.Params.PlayerId) == 0 {
		return GetEloReset400JSONResponse{Status: "fail", Message: "player_id required"}, nil
	}

	calcDate := time.Now().UTC()
	if request.Params.CalcDate != nil {
		calcDate = request.Params.CalcDate.UTC()
	}

	rows, err := s.api.MatchService.ListMatchesForEloReset(ctx, calcDate)
	if err != nil {
		return nil, err
	}

	res := elopkg.ComputeEloReset(rows, request.Params.PlayerId, calcDate)

	series := make([]EloResetSeriesPoint, len(res.Series))
	for i, p := range res.Series {
		series[i] = EloResetSeriesPoint{ResetDate: p.ResetDate, Players: p.Players}
	}
	players := make([]EloResetPlayerInfo, len(res.Players))
	for i, p := range res.Players {
		players[i] = EloResetPlayerInfo{Id: p.ID, Name: p.Name}
	}

	return GetEloReset200JSONResponse{Status: "success", Data: EloResetResult{
		Series:  series,
		Players: players,
	}}, nil
}
