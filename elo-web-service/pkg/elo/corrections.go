package elo

import (
	"context"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type ICorrectionService interface {
	CreateGlobalArenaRatingCorrection(ctx context.Context, correctionID, playerID id.ID, diff float64) error
	ListCorrectionsPaginated(ctx context.Context, arg db.ListCorrectionsPaginatedParams) ([]db.ListCorrectionsPaginatedRow, error)
}

type CorrectionService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
}

func NewCorrectionService(pool *pgxpool.Pool, arenas *ArenaService) ICorrectionService {
	return &CorrectionService{Queries: db.New(pool), Pool: pool, Arenas: arenas}
}

// ListCorrectionsPaginated exposes the paginated corrections read behind the
// service boundary so handlers do not call *db.Queries directly.
func (s *CorrectionService) ListCorrectionsPaginated(ctx context.Context, arg db.ListCorrectionsPaginatedParams) ([]db.ListCorrectionsPaginatedRow, error) {
	return s.Queries.ListCorrectionsPaginated(ctx, arg)
}

func (s *CorrectionService) CreateGlobalArenaRatingCorrection(ctx context.Context, correctionID, playerID id.ID, diff float64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := db.New(tx)

	correction, err := q.CreateCorrection(ctx, db.CreateCorrectionParams{
		ID:            correctionID,
		PlayerID:      playerID,
		Discriminator: "correction",
		Diff:          diff,
	})
	if err != nil {
		return fmt.Errorf("create correction: %w", err)
	}

	if err := applyCorrectionWithinTx(ctx, q, correction); err != nil {
		return fmt.Errorf("apply correction: %w", err)
	}

	return tx.Commit(ctx)
}

// applyCorrectionWithinTx applies a rating correction to the global arena
// (the only arena corrections touch) inside an already-open transaction. Used
// by CreateGlobalArenaRatingCorrection and by EventProcessor.RecalculateFrom
// when replaying corrections.
func applyCorrectionWithinTx(ctx context.Context, q *db.Queries, correction db.Correction) error {
	arena, err := globalArena(ctx, q)
	if err != nil {
		return err
	}

	settingsRow, err := q.GetEloSettingsForDate(ctx, correction.Date)
	if err != nil {
		return fmt.Errorf("get elo settings for correction %s: %w", correction.ID, err)
	}
	settings := EloSettingsFromDB(settingsRow)

	prevRow, err := q.GetPlayerLatestArenaStateBeforeCorrection(ctx, db.GetPlayerLatestArenaStateBeforeCorrectionParams{
		ArenaID:      GlobalArenaID,
		PlayerID:     correction.PlayerID,
		Date:         correction.Date,
		CorrectionID: &correction.ID,
	})

	var prevRating, prevElo float64
	var prevLeague *string
	if err != nil {
		prevRating = arena.Settings.StartingRating
		prevElo = settings.StartingElo
		prevLeague = initialArenaLeague(arena, settings)
	} else {
		prevRating = prevRow.Rating
		prevElo = prevRow.Elo
		prevLeague = textPtr(prevRow.League)
	}

	newRating := prevRating + correction.Diff
	ratingStaked := math.Min(correction.Diff, 0)
	ratingEarned := math.Max(correction.Diff, 0)
	league := determineCorrectionLeague(prevLeague, newRating, prevElo, arena)

	return q.UpsertArenaSettlementByCorrection(ctx, db.UpsertArenaSettlementByCorrectionParams{
		ID:           newSettlementID(),
		ArenaID:      GlobalArenaID,
		PlayerID:     correction.PlayerID,
		Date:         correction.Date,
		RatingAfter:  newRating,
		EloAfter:     prevElo,
		CorrectionID: &correction.ID,
		RatingStaked: ratingStaked,
		RatingEarned: ratingEarned,
		League:       ptrText(league),
	})
}

// globalArena reads the global arena row with its settings parsed inside an
// open transaction.
func globalArena(ctx context.Context, q *db.Queries) (Arena, error) {
	r, err := q.GetArena(ctx, GlobalArenaID)
	if err != nil {
		return Arena{}, fmt.Errorf("get global arena: %w", err)
	}
	return arenaFromGetArenaRow(r)
}
