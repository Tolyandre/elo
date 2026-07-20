package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/calculator"
)

func init() {
	// Wire the real data-migration runner. Invoked from MigrateCalculatorData
	// (see migrations.go) after the SQL schema migration in every startup mode.
	MigrateDataRunner = migrateCalculatorData
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
