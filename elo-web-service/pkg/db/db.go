package db

import (
	"fmt"
	"net/url"

	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
	"github.com/tolyandre/elo-web-service/pkg/configuration"
)

// buildDSN returns a DSN string with password taken from ELO_WEB_SERVICE_POSTGRES_PASSWORD
func buildDSN() (string, error) {
	u, err := url.Parse(configuration.Config.PostgresDSN)
	if err != nil {
		return "", fmt.Errorf("invalid postgres DSN: %w", err)
	}

	pwd := configuration.Config.PostgresPassword
	if u.User == nil && pwd != "" {
		return "", fmt.Errorf("Postgres user is not specified but password is privided")
	}

	_, hasPasswordInUrl := u.User.Password()
	if hasPasswordInUrl && pwd != "" {
		return "", fmt.Errorf("Postgres user and password are specified but only one is allowed")
	}

	if pwd != "" {
		u.User = url.UserPassword(u.User.Username(), pwd)
	}

	return u.String(), nil
}

// OpenDB constructs DSN and opens a *sqlx.DB (pgx driver)
func OpenDB() (*sqlx.DB, error) {
	final, err := buildDSN()
	if err != nil {
		return nil, err
	}
	db, err := sqlx.Open("pgx", final)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}

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
