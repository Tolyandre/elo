package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/calculator"
)

func init() {
	// Wire the real data-migration runner. Invoked from MigrateCalculatorData
	// (see migrations.go) after the SQL schema migration in every startup mode.
	MigrateDataRunner = func(ctx context.Context, pool *pgxpool.Pool) error {
		if err := migrateCalculatorData(ctx, pool); err != nil {
			return err
		}
		return migrateMarketShares(ctx, pool)
	}
}

// migrateCalculatorData walks every match whose calculator_schema_version is
// behind the current version for its kind, applies the registered migrators,
// and writes the upgraded document back. Each row is upgraded in its own
// transaction so a single corrupt row cannot roll back an entire batch.
//
// On any error this function returns a non-nil error, which main treats as
// fatal (the application refuses to start) — mirroring how SQL schema
// migration failures are handled.
func migrateCalculatorData(ctx context.Context, pool *pgxpool.Pool) error {
	for _, kind := range calculator.Kinds() {
		schema, err := calculator.Lookup(kind)
		if err != nil {
			// Should not happen — kind came from Kinds().
			return fmt.Errorf("lookup kind %q: %w", kind, err)
		}
		if err := migrateKind(ctx, pool, kind, schema.CurrentVersion); err != nil {
			return fmt.Errorf("kind %q: %w", kind, err)
		}
	}
	return nil
}

func migrateKind(ctx context.Context, pool *pgxpool.Pool, kind string, currentVersion int) error {
	// No migrators for this kind → nothing to do. (Saves a table scan.)
	if !calculator.HasMigrators(kind) {
		return nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, calculator_schema_version, calculator_data
		FROM matches
		WHERE calculator_kind = $1 AND calculator_schema_version < $2
	`, kind, currentVersion)
	if err != nil {
		return fmt.Errorf("query stale rows: %w", err)
	}
	defer rows.Close()

	stale := make([]staleCalculatorRow, 0)
	for rows.Next() {
		var r staleCalculatorRow
		var version *int32
		if err := rows.Scan(&r.ID, &version, &r.Data); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}
		if version == nil {
			// Defensive: should not happen given the WHERE clause, but CHECK
			// allows NULL only when kind is also NULL — already excluded.
			continue
		}
		r.Kind = kind
		r.SchemaVersion = int(*version)
		stale = append(stale, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate rows: %w", err)
	}
	if len(stale) == 0 {
		return nil
	}

	log.Printf("calculator migration: upgrading %d %q rows from older versions", len(stale), kind)
	for _, r := range stale {
		newData, newVersion, err := calculator.MigrateData(r.Kind, r.SchemaVersion, r.Data)
		if err != nil {
			return fmt.Errorf("migrate match %s: %w", r.ID, err)
		}
		if newVersion == r.SchemaVersion {
			continue // no-op
		}
		if err := updateMatchCalculator(ctx, pool, r.ID, newVersion, newData); err != nil {
			return fmt.Errorf("update match %s: %w", r.ID, err)
		}
		log.Printf("calculator migration: match %s %q v%d→v%d", r.ID, r.Kind, r.SchemaVersion, newVersion)
	}
	return nil
}

func updateMatchCalculator(ctx context.Context, pool *pgxpool.Pool, matchID string, version int, data json.RawMessage) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		UPDATE matches
		SET calculator_schema_version = $2, calculator_data = $3
		WHERE id = $1
	`, matchID, version, []byte(data))
	if err != nil {
		return err
	}
	// Re-serialize to a plain map for validation via the registry (which works
	// on json.RawMessage). We re-validate the persisted form to catch a
	// migrator that wrote a structurally-invalid document.
	if err := validateStored(ctx, tx, matchID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validateStored(ctx context.Context, tx pgx.Tx, matchID string) error {
	var kind *string
	var data []byte
	if err := tx.QueryRow(ctx, `
		SELECT calculator_kind, calculator_data FROM matches WHERE id = $1
	`, matchID).Scan(&kind, &data); err != nil {
		return fmt.Errorf("re-read: %w", err)
	}
	if kind == nil {
		return nil
	}
	// MigrateData already validated before the write, so this is belt-and-
	// suspenders. Skip if there is nothing to validate.
	if len(data) == 0 {
		return nil
	}
	if err := calculator.Validate(*kind, json.RawMessage(data)); err != nil {
		return fmt.Errorf("post-write validation: %w", err)
	}
	return nil
}

// migrateMarketShares backfills bets.shares for pre-LMSR (parimutuel) markets so
// the share settlement reproduces the exact historical payout.
//
// Deploy precondition (ADR-10): the migration runs when no open/betting_closed
// markets exist, so every historical market is resolved or cancelled. The guard
// `q_yes = 0 AND q_no = 0` selects exactly the pre-LMSR markets: any bet placed
// under the new LMSR code writes non-zero q_* via UpdateMarketAMMState, so real
// LMSR bets are never overwritten. The backfill is deterministic and idempotent.
//
// For a resolved market the winning side gets shares = amount × totalPool/winningPool
// (so shares × 1 reproduces the parimutuel share exactly); the losing side gets the
// symmetric amount × totalPool/losingPool (payout is 0 regardless). The resulting
// settlement residual is 0, so no guarantor rows are produced and historical elo is
// preserved byte-for-byte. Cancelled markets refund the elo spent regardless of
// shares, so they are left at the default 0.
func migrateMarketShares(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `
		SELECT id, resolution_outcome, liquidity_b
		FROM markets
		WHERE status = 'resolved' AND q_yes = 0 AND q_no = 0
	`)
	if err != nil {
		return fmt.Errorf("query pre-lmsr markets: %w", err)
	}

	type staleMarket struct {
		ID                string
		ResolutionOutcome *string
		LiquidityB        float64
	}
	stale := make([]staleMarket, 0)
	for rows.Next() {
		var m staleMarket
		if err := rows.Scan(&m.ID, &m.ResolutionOutcome, &m.LiquidityB); err != nil {
			rows.Close()
			return fmt.Errorf("scan market: %w", err)
		}
		stale = append(stale, m)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate markets: %w", err)
	}
	if len(stale) == 0 {
		return nil
	}

	log.Printf("market migration: backfilling shares for %d pre-lmsr markets", len(stale))
	for _, m := range stale {
		if m.ResolutionOutcome == nil {
			continue
		}
		outcome := *m.ResolutionOutcome
		if outcome != "yes" && outcome != "no" {
			continue
		}
		if err := backfillMarketShares(ctx, pool, m.ID, outcome, m.LiquidityB); err != nil {
			return fmt.Errorf("backfill market %s: %w", m.ID, err)
		}
	}
	return nil
}

func backfillMarketShares(ctx context.Context, pool *pgxpool.Pool, marketID, winningOutcome string, liquidityB float64) error {
	aggRows, err := pool.Query(ctx, `
		SELECT outcome, SUM(amount)::float8 AS total
		FROM bets WHERE market_id = $1 GROUP BY outcome
	`, marketID)
	if err != nil {
		return fmt.Errorf("aggregate bets: %w", err)
	}
	yesPool, noPool := 0.0, 0.0
	for aggRows.Next() {
		var outcome string
		var total float64
		if err := aggRows.Scan(&outcome, &total); err != nil {
			aggRows.Close()
			return fmt.Errorf("scan aggregate: %w", err)
		}
		if outcome == "yes" {
			yesPool = total
		} else {
			noPool = total
		}
	}
	if err := aggRows.Err(); err != nil {
		return fmt.Errorf("iterate aggregates: %w", err)
	}

	totalPool := yesPool + noPool
	if totalPool == 0 {
		return nil // no bets to backfill
	}
	var winPool, losePool float64
	if winningOutcome == "yes" {
		winPool, losePool = yesPool, noPool
	} else {
		winPool, losePool = noPool, yesPool
	}
	// shares = amount × (totalPool / pool_of_outcome). Storing the per-bet ratio
	// lets us write one UPDATE that scales each row's own amount.
	winRatio := 1.0
	if winPool > 0 {
		winRatio = totalPool / winPool
	}
	loseRatio := 1.0
	if losePool > 0 {
		loseRatio = totalPool / losePool
	}

	// Cast the branches to float8 explicitly: pgx sends untyped params as text,
	// and without the cast amount * (CASE ...) resolves to text, which won't assign
	// to a double-precision column (SQLSTATE 42804).
	_, err = pool.Exec(ctx, `
		UPDATE bets
		SET shares = amount * CASE WHEN outcome = $1 THEN $2::float8 ELSE $3::float8 END
		WHERE market_id = $4
	`, winningOutcome, winRatio, loseRatio, marketID)
	if err != nil {
		return fmt.Errorf("update shares: %w", err)
	}

	// Seed q_yes/q_no so the displayed LMSR price reflects the historical pool-
	// implied probability (p_yes = yesPool/totalPool). q_yes - q_no = b·ln(yesPool/noPool).
	// One-sided markets are clamped to a near-certain price.
	b := liquidityB
	if b <= 0 {
		b = 16
	}
	qYes, qNo := 0.0, 0.0
	switch {
	case yesPool > 0 && noPool > 0:
		qYes = b * math.Log(yesPool/noPool)
	case yesPool > 0: // noPool == 0 → ~certain YES
		qYes = b * 5
	case noPool > 0: // yesPool == 0 → ~certain NO
		qNo = b * 5
	}
	if _, err := pool.Exec(ctx, `
		UPDATE markets SET q_yes = $2::float8, q_no = $3::float8 WHERE id = $1
	`, marketID, qYes, qNo); err != nil {
		return fmt.Errorf("seed amm state: %w", err)
	}
	return nil
}
