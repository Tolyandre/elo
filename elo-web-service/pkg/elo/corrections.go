package elo

import (
	"context"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type ICorrectionService interface {
	CreateGlobalArenaRatingCorrection(ctx context.Context, id string, playerID string, diff float64) error
}

type CorrectionService struct {
	Pool *pgxpool.Pool
}

func NewCorrectionService(pool *pgxpool.Pool) ICorrectionService {
	return &CorrectionService{Pool: pool}
}

func (s *CorrectionService) CreateGlobalArenaRatingCorrection(ctx context.Context, id string, playerID string, diff float64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	q := db.New(tx)

	correction, err := q.CreateCorrection(ctx, db.CreateCorrectionParams{
		ID:            id,
		PlayerID:      playerID,
		Discriminator: "correction",
		Diff:          diff,
	})
	if err != nil {
		return fmt.Errorf("create correction: %w", err)
	}

	settingsRow, err := q.GetEloSettingsForDate(ctx, correction.Date)
	if err != nil {
		return fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	prevRow, err := q.GetPlayerLatestGlobalStateBeforeCorrection(ctx, db.GetPlayerLatestGlobalStateBeforeCorrectionParams{
		PlayerID:     playerID,
		Date:         correction.Date,
		CorrectionID: &correction.ID,
	})

	var prevRating, prevElo float64
	var prevLeague string
	if err != nil {
		prevRating = settings.StartingRatingGlobal
		prevElo = settings.StartingElo
		prevLeague = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
	} else {
		prevRating = prevRow.Rating
		prevElo = prevRow.Elo
		prevLeague = prevRow.League
	}

	newRating := prevRating + diff
	ratingStaked := math.Min(diff, 0)
	ratingEarned := math.Max(diff, 0)
	league := determineCorrectionLeague(prevLeague, newRating, prevElo, settings)

	if err := q.UpsertGlobalArenaSettlementByCorrection(ctx, db.UpsertGlobalArenaSettlementByCorrectionParams{
		ID:           newSettlementID(),
		PlayerID:     playerID,
		Date:         correction.Date,
		RatingAfter:  newRating,
		EloAfter:     prevElo,
		CorrectionID: &correction.ID,
		RatingStaked: ratingStaked,
		RatingEarned: ratingEarned,
		League:       league,
	}); err != nil {
		return fmt.Errorf("upsert correction settlement: %w", err)
	}

	return tx.Commit(ctx)
}

// determineCorrectionLeague returns the league after a manual rating correction.
// Uses isInNewbieLeague (shared with match settlements) to check the gap condition.
// Corrections can demote any player to newbie if the gap opens (elo - rating > goalGap),
// unlike match settlements which only check the gap for players already in the newbie league.
func determineCorrectionLeague(prev string, newRating, prevElo float64, s EloSettings) string {
	if isInNewbieLeague(newRating, prevElo, s) { // prevElo - newRating > goalGap
		return "newbie"
	}
	if prev == "newbie" {
		return "amateur"
	}
	return prev
}

// applyCorrectionWithinTx applies a correction settlement inside an already-open transaction.
// Used by EventProcessor.RecalculateFrom when replaying corrections.
func applyCorrectionWithinTx(ctx context.Context, q *db.Queries, correction db.Correction) error {
	settingsRow, err := q.GetEloSettingsForDate(ctx, correction.Date)
	if err != nil {
		return fmt.Errorf("get elo settings for correction %s: %w", correction.ID, err)
	}
	settings := EloSettingsFromDB(settingsRow)

	prevRow, err := q.GetPlayerLatestGlobalStateBeforeCorrection(ctx, db.GetPlayerLatestGlobalStateBeforeCorrectionParams{
		PlayerID:     correction.PlayerID,
		Date:         correction.Date,
		CorrectionID: &correction.ID,
	})

	var prevRating, prevElo float64
	var prevLeague string
	if err != nil {
		prevRating = settings.StartingRatingGlobal
		prevElo = settings.StartingElo
		prevLeague = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
	} else {
		prevRating = prevRow.Rating
		prevElo = prevRow.Elo
		prevLeague = prevRow.League
	}

	newRating := prevRating + correction.Diff
	ratingStaked := math.Min(correction.Diff, 0)
	ratingEarned := math.Max(correction.Diff, 0)
	league := determineCorrectionLeague(prevLeague, newRating, prevElo, settings)

	return q.UpsertGlobalArenaSettlementByCorrection(ctx, db.UpsertGlobalArenaSettlementByCorrectionParams{
		ID:           newSettlementID(),
		PlayerID:     correction.PlayerID,
		Date:         correction.Date,
		RatingAfter:  newRating,
		EloAfter:     prevElo,
		CorrectionID: &correction.ID,
		RatingStaked: ratingStaked,
		RatingEarned: ratingEarned,
		League:       league,
	})
}
