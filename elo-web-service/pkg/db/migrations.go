package db

import (
	"fmt"
	"log"

	"github.com/golang-migrate/migrate/v4"
	sourceiofs "github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/tolyandre/elo-web-service/migrations"
)

// MigrateUp runs migrations from ./migrations directory against the provided DSN
func MigrateUp() error {
	final, err := buildDSN()
	if err != nil {
		return err
	}
	// Use embedded migrations compiled into the binary.
	if err := runMigrationsEmbedded(final); err != nil {
		return err
	}
	return nil
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
