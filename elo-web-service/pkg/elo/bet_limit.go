package elo

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// CalcBetLimit computes the bet limit for a player given their current Elo and the active settings.
// Formula: K / (1 + 10^((startingElo - playerElo) / D))
// This equals the elo_pay the player would risk in a 2-player match against a starting_elo opponent.
func CalcBetLimit(playerElo float64, settings EloSettings) float64 {
	return settings.K / (1 + math.Pow(10, (settings.StartingElo-playerElo)/settings.D))
}

// BetLimitForPlayer derives the player's bet limit against the given arena —
// since ADR-36 phase 5 the market's tenant main arena, not a stored global
// column: current settings, the player's latest elo in that arena, falling
// back to the starting elo until they have played there.
func BetLimitForPlayer(ctx context.Context, q *db.Queries, arenaID id.ID, playerID id.ID) (float64, error) {
	row, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		return 0, fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(row)

	playerElo := settings.StartingElo
	if elo, err := q.GetPlayerLatestArenaElo(ctx, db.GetPlayerLatestArenaEloParams{
		ArenaID:  arenaID,
		PlayerID: playerID,
	}); err == nil {
		playerElo = elo
	} else if !db.IsNoRows(err) {
		return 0, fmt.Errorf("get player arena elo: %w", err)
	}

	return CalcBetLimit(playerElo, settings), nil
}
