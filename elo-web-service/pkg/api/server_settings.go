package api

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (s *StrictServer) GetSettings(ctx context.Context, _ GetSettingsRequestObject) (GetSettingsResponseObject, error) {
	settings, err := s.api.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		return nil, err
	}
	return GetSettings200JSONResponse{
		Status: "success",
		Data: Settings{
			EloConstK:   settings.EloConstK,
			EloConstD:   settings.EloConstD,
			StartingElo: settings.StartingElo,
			WinReward:   settings.WinReward,
		},
	}, nil
}

func (s *StrictServer) ListAllSettings(ctx context.Context, _ ListAllSettingsRequestObject) (ListAllSettingsResponseObject, error) {
	rows, err := s.api.Queries.ListEloSettings(ctx)
	if err != nil {
		return nil, err
	}

	entries := make([]EloSettingEntry, 0, len(rows))
	for _, r := range rows {
		var dateStr string
		if r.EffectiveDate.InfinityModifier == pgtype.NegativeInfinity {
			dateStr = "-infinity"
		} else {
			dateStr = r.EffectiveDate.Time.Format(time.RFC3339)
		}
		entries = append(entries, EloSettingEntry{
			EffectiveDate: dateStr,
			EloConstK:     r.EloConstK,
			EloConstD:     r.EloConstD,
			StartingElo:   r.StartingElo,
			WinReward:     r.WinReward,
		})
	}

	return ListAllSettings200JSONResponse{Status: "success", Data: entries}, nil
}

func (s *StrictServer) CreateSettings(ctx context.Context, request CreateSettingsRequestObject) (CreateSettingsResponseObject, error) {
	payload := request.Body

	if payload.WinReward < 0.1 || payload.WinReward > 5 {
		return CreateSettings400JSONResponse{Status: "fail", Message: "win_reward must be between 0.1 and 5"}, nil
	}
	if !payload.EffectiveDate.After(time.Now()) {
		return CreateSettings400JSONResponse{Status: "fail", Message: "effective_date must be in the future"}, nil
	}

	err := s.api.Queries.CreateEloSettings(ctx, db.CreateEloSettingsParams{
		EffectiveDate: pgtype.Timestamptz{Time: payload.EffectiveDate, Valid: true},
		EloConstK:     payload.EloConstK,
		EloConstD:     payload.EloConstD,
		StartingElo:   payload.StartingElo,
		WinReward:     payload.WinReward,
	})
	if err != nil {
		return nil, err
	}

	return CreateSettings201JSONResponse{Status: "success", Message: "Settings created"}, nil
}

func (s *StrictServer) DeleteSettings(ctx context.Context, request DeleteSettingsRequestObject) (DeleteSettingsResponseObject, error) {
	effectiveDate := request.Body.EffectiveDate
	if !effectiveDate.After(time.Now()) {
		return DeleteSettings400JSONResponse{Status: "fail", Message: "can only delete future settings"}, nil
	}

	err := s.api.Queries.DeleteEloSettings(ctx, pgtype.Timestamptz{Time: effectiveDate, Valid: true})
	if err != nil {
		return nil, err
	}

	return DeleteSettings200JSONResponse{Status: "success", Message: "Settings deleted"}, nil
}
