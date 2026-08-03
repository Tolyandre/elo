package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// IEloSettingsService owns read/write access to the elo_settings time-series
// table. It exists so the admin handlers (GetSettings/ListAllSettings/
// CreateSettings/DeleteSettings) go through the service boundary instead of
// calling *db.Queries directly.
type IEloSettingsService interface {
	GetForDate(ctx context.Context, t pgtype.Timestamptz) (db.GetEloSettingsForDateRow, error)
	GetLatest(ctx context.Context) (db.GetLatestEloSettingsRow, error)
	List(ctx context.Context) ([]db.ListEloSettingsRow, error)
	Create(ctx context.Context, arg db.CreateEloSettingsParams) error
	Delete(ctx context.Context, t pgtype.Timestamptz) error
}

type EloSettingsService struct {
	Queries *db.Queries
}

func NewEloSettingsService(pool *pgxpool.Pool) *EloSettingsService {
	return &EloSettingsService{Queries: db.New(pool)}
}

// GetForDate returns the effective elo settings row for the given timestamp.
func (s *EloSettingsService) GetForDate(ctx context.Context, t pgtype.Timestamptz) (db.GetEloSettingsForDateRow, error) {
	return s.Queries.GetEloSettingsForDate(ctx, t)
}

// GetLatest returns the newest elo settings entry overall (including future-scheduled).
func (s *EloSettingsService) GetLatest(ctx context.Context) (db.GetLatestEloSettingsRow, error) {
	return s.Queries.GetLatestEloSettings(ctx)
}

// List returns every elo settings entry, oldest first.
func (s *EloSettingsService) List(ctx context.Context) ([]db.ListEloSettingsRow, error) {
	return s.Queries.ListEloSettings(ctx)
}

// Create inserts a new elo settings entry effective at the given date.
func (s *EloSettingsService) Create(ctx context.Context, arg db.CreateEloSettingsParams) error {
	return s.Queries.CreateEloSettings(ctx, arg)
}

// Delete removes the elo settings entry effective at the given (future) date.
func (s *EloSettingsService) Delete(ctx context.Context, t pgtype.Timestamptz) error {
	return s.Queries.DeleteEloSettings(ctx, t)
}
