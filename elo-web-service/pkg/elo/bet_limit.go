package elo

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// CalcBetLimit computes the bet limit for a player given their current Elo and the active settings.
// Formula: K / (1 + 10^((startingElo - playerElo) / D))
// This equals the elo_pay the player would risk in a 2-player match against a starting_elo opponent.
func CalcBetLimit(playerElo float64, settings EloSettings) float64 {
	return settings.K / (1 + math.Pow(10, (settings.StartingElo-playerElo)/settings.D))
}

// RecalculateBetLimits updates bet_limit for the given players using current Elo settings.
// Must be called within a transaction (q is a transactional *db.Queries).
func RecalculateBetLimits(ctx context.Context, q *db.Queries, playerIDs []int32) error {
	if len(playerIDs) == 0 {
		return nil
	}

	row, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		return err
	}
	settings := EloSettingsFromDB(row)

	for _, playerID := range playerIDs {
		var playerElo float64
		elo, err := q.GetPlayerLatestGlobalElo(ctx, playerID)
		if err != nil {
			playerElo = settings.StartingElo
		} else {
			playerElo = elo
		}

		limit := CalcBetLimit(playerElo, settings)
		if err := q.UpdatePlayerBetLimit(ctx, db.UpdatePlayerBetLimitParams{
			ID:       playerID,
			BetLimit: limit,
		}); err != nil {
			return err
		}
	}

	return nil
}
