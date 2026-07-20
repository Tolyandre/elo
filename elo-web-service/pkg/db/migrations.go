package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/golang-migrate/migrate/v4"
	sourceiofs "github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/migrations"
)

// MigrateUp runs migrations from ./migrations directory against the provided DSN
func MigrateUp() error {
	final, err := BuildDSN()
	if err != nil {
		return err
	}
	// Use embedded migrations compiled into the binary.
	if err := runMigrationsEmbedded(final); err != nil {
		return err
	}
	return nil
}

// MigrateUpWithDSN applies migrations to an arbitrary DSN.
// Intended for local dev (--migrate-db-dsn flag) and integration tests.
// Does not require the global config to be loaded.
func MigrateUpWithDSN(dsn string) error {
	return runMigrationsEmbedded(dsn)
}

// runMigrationsEmbedded runs migrations embedded into the binary using the iofs source driver.
func runMigrationsEmbedded(dsn string) error {
	src, err := sourceiofs.New(migrations.MigrationsFS, ".")
	if err != nil {
		return fmt.Errorf("failed to create iofs source driver: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	if err := m.Up(); err != nil {
		if err == migrate.ErrNoChange {
			log.Printf("migrations: no change")
			return nil
		}
		return fmt.Errorf("migration failed: %w", err)
	}
	return nil
}

// MigrateDataRunner is invoked by main after the SQL schema migration, to apply
// any in-process data migrations that depend on Go code (as opposed to SQL).
// It is declared here (not in pkg/calculator) to avoid an import cycle:
// pkg/calculator must stay free of db/pgx deps.
//
// main wires the real implementation (pkg/db/migrate_data.go) at startup. When
// unset (e.g. in tests that don't care), MigrateCalculatorData is a no-op.
var MigrateDataRunner func(ctx context.Context, pool *pgxpool.Pool) error

// MigrateCalculatorData runs the registered data migrations (currently just
// calculator documents) against the given DSN. Intended to be called from main
// right after the SQL schema migration in every startup mode
// (--migrate-db, --migrate-db-dsn, normal boot). Returns nil when there is
// nothing to do or when no runner is registered.
func MigrateCalculatorData(ctx context.Context, dsn string) error {
	if MigrateDataRunner == nil {
		return nil
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("migrate calculator data: connect: %w", err)
	}
	defer pool.Close()
	if err := MigrateDataRunner(ctx, pool); err != nil {
		return fmt.Errorf("migrate calculator data: %w", err)
	}
	return nil
}

// migrateCalculatorDataQuery identifies rows whose stored schema_version is
// behind the current version for their kind. Drives MigrateCalculatorData.
// Kept here (next to the runner) so the row scan stays in lockstep with the
// SELECT.
type staleCalculatorRow struct {
	ID            string
	Kind          string
	SchemaVersion int
	Data          json.RawMessage
}
