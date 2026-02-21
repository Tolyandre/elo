package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type MatchService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewMatchService(pool *pgxpool.Pool) IMatchService {
	return &MatchService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

type IMatchService interface {
	AddMatch(ctx context.Context, gameName string, playerScores map[string]float64, date *time.Time, googleSheetRow *int, settings googlesheet.Settings) (db.Match, error)
	ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow, settings googlesheet.Settings) ([]db.Match, error)
}

// AddMatch adds a single match with Elo calculations
func (s *MatchService) AddMatch(ctx context.Context, gameName string, playerScores map[string]float64, date *time.Time, googleSheetRow *int, settings googlesheet.Settings) (db.Match, error) {
	// start a transaction
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	// find or create game
	game, err := q.GetGameByName(ctx, gameName)
	if err != nil {
		// try to create the game if it doesn't exist
		game, err = q.AddGame(ctx, gameName)
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to find or create game '%s': %v", gameName, err)
		}
	}

	// prepare date parameter
	var dt pgtype.Timestamptz
	if date == nil {
		dt = pgtype.Timestamptz{Valid: false}
	} else {
		dt = pgtype.Timestamptz{Time: *date, Valid: true}
	}

	// prepare google sheet row parameter
	var gsRow pgtype.Int4
	if googleSheetRow == nil {
		gsRow = pgtype.Int4{Valid: false}
	} else {
		gsRow = pgtype.Int4{Int32: int32(*googleSheetRow), Valid: true}
	}

	// create match
	createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
		Date:           dt,
		GameID:         game.ID,
		GoogleSheetRow: gsRow,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to create match: %v", err)
	}

	// Get latest Elo for each player
	// IMPORTANT: Lock players in a consistent order (sorted by name) to prevent deadlocks
	previousElo := make(map[string]float64)
	playerIDMap := make(map[string]int32) // track player IDs

	// Sort player names to lock in consistent order
	playerNames := make([]string, 0, len(playerScores))
	for playerName := range playerScores {
		playerNames = append(playerNames, playerName)
	}
	// Sort alphabetically to ensure consistent locking order
	sortPlayerNames(playerNames)

	for _, playerName := range playerNames {
		// find or create player
		player, err := q.GetPlayerByName(ctx, playerName)
		if err != nil {
			p, err2 := q.CreatePlayer(ctx, db.CreatePlayerParams{
				Name:              playerName,
				GeologistName:     pgtype.Text{Valid: false},
				GoogleSheetColumn: pgtype.Int4{Valid: false},
			})
			if err2 != nil {
				return db.Match{}, fmt.Errorf("unable to find or create player '%s': %v", playerName, err2)
			}
			player = p
		}

		playerIDMap[playerName] = player.ID

		// Lock the player row to prevent concurrent Elo calculations
		// This ensures that if two matches are added concurrently for the same player,
		// they will be processed sequentially
		_, err = q.LockPlayerForEloCalculation(ctx, player.ID)
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to lock player '%s' for Elo calculation: %v", playerName, err)
		}

		// Get latest Elo for this player (now safe from concurrent updates)
		latestElo, err := q.GetPlayerLatestElo(ctx, player.ID)
		if err != nil {
			// No previous matches, use starting Elo
			previousElo[playerName] = StartingElo
		} else {
			if latestElo.Valid {
				previousElo[playerName] = latestElo.Float64
			} else {
				previousElo[playerName] = StartingElo
			}
		}
	}

	// Calculate new Elos
	newElos := CalculateNewElo(previousElo, StartingElo, playerScores, settings.EloConstK, settings.EloConstD)

	// Calculate individual components
	absoluteLoserScore := GetAsboluteLoserScore(playerScores)

	// Create match scores with Elo values
	for playerName, score := range playerScores {
		playerID := playerIDMap[playerName]
		prevElo := previousElo[playerName]
		newElo := newElos[playerName]

		// elo_pay = -K * WinExpectation
		eloPay := -settings.EloConstK * WinExpectation(prevElo, playerScores, StartingElo, previousElo, settings.EloConstD)

		// elo_earn = K * NormalizedScore
		eloEarn := settings.EloConstK * NormalizedScore(score, playerScores, absoluteLoserScore)

		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  createdMatch.ID,
			PlayerID: playerID,
			Score:    score,
			EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
			EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
			NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
		}); err != nil {
			return db.Match{}, fmt.Errorf("unable to upsert match score for player %s: %v", playerName, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %v", err)
	}

	return createdMatch, nil
}

// sortPlayerNames sorts player names alphabetically (for consistent locking order)
func sortPlayerNames(names []string) {
	// Simple bubble sort is fine for small slices
	for i := 0; i < len(names); i++ {
		for j := i + 1; j < len(names); j++ {
			if names[i] > names[j] {
				names[i], names[j] = names[j], names[i]
			}
		}
	}
}


func (s *MatchService) ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow, settings googlesheet.Settings) ([]db.Match, error) {
	// start a transaction so replace is atomic
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	// delete existing data
	if err := q.DeleteAllMatchScores(ctx); err != nil {
		return nil, fmt.Errorf("unable to delete match_scores: %v", err)
	}
	if err := q.DeleteAllMatches(ctx); err != nil {
		return nil, fmt.Errorf("unable to delete matches: %v", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("unable to commit delete tx: %v", err)
	}

	// Track current Elo for each player across matches
	// Use player name as key since that's what matchRows use
	currentElo := make(map[string]float64)

	inserted := make([]db.Match, 0, len(matchRows))

	// skip first row as it contains start elo value (fake match)
	for _, mr := range matchRows[1:] {
		// Use the tracked Elo from previous matches in the batch
		// instead of querying the database (which would be empty after deletion)

		// Override AddMatch to use our tracked Elo
		// Start a new transaction for each match
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("unable to begin tx: %v", err)
		}

		q := s.Queries.WithTx(tx)

		// find or create game
		game, err := q.GetGameByName(ctx, mr.Game)
		if err != nil {
			game, err = q.AddGame(ctx, mr.Game)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("unable to find or create game '%s': %v", mr.Game, err)
			}
		}

		// prepare date
		var dt pgtype.Timestamptz
		if mr.Date == nil {
			dt = pgtype.Timestamptz{Valid: false}
		} else {
			dt = pgtype.Timestamptz{Time: *mr.Date, Valid: true}
		}

		gsRow := pgtype.Int4{Int32: int32(mr.RowNum), Valid: true}

		createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
			Date:           dt,
			GameID:         game.ID,
			GoogleSheetRow: gsRow,
		})
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, fmt.Errorf("unable to create match for row %d: %v", mr.RowNum, err)
		}

		// Build previousElo map using tracked Elo from previous matches
		previousElo := make(map[string]float64)
		for playerName := range mr.PlayersScore {
			if elo, exists := currentElo[playerName]; exists {
				previousElo[playerName] = elo
			} else {
				previousElo[playerName] = StartingElo
			}
		}

		// Calculate new Elos
		newElos := CalculateNewElo(previousElo, StartingElo, mr.PlayersScore, settings.EloConstK, settings.EloConstD)

		absoluteLoserScore := GetAsboluteLoserScore(mr.PlayersScore)

		// create scores with Elo values
		for playerName, score := range mr.PlayersScore {
			player, err := q.GetPlayerByName(ctx, playerName)
			if err != nil {
				p, err2 := q.CreatePlayer(ctx, db.CreatePlayerParams{
					Name:              playerName,
					GeologistName:     pgtype.Text{Valid: false},
					GoogleSheetColumn: pgtype.Int4{Valid: false},
				})
				if err2 != nil {
					_ = tx.Rollback(ctx)
					return nil, fmt.Errorf("unable to find or create player '%s': %v", playerName, err2)
				}
				player = p
			}

			prevElo := previousElo[playerName]
			newElo := newElos[playerName]

			eloPay := -settings.EloConstK * WinExpectation(prevElo, mr.PlayersScore, StartingElo, previousElo, settings.EloConstD)
			eloEarn := settings.EloConstK * NormalizedScore(score, mr.PlayersScore, absoluteLoserScore)

			if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
				MatchID:  createdMatch.ID,
				PlayerID: player.ID,
				Score:    score,
				EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
				EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
				NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
			}); err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("unable to upsert match score for match %d player %s: %v", createdMatch.ID, playerName, err)
			}

			// Update tracked Elo for next match
			currentElo[playerName] = newElo
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("unable to commit tx: %v", err)
		}

		inserted = append(inserted, createdMatch)
	}

	return inserted, nil
}
