package db

import (
	"fmt"
	"net/url"

	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/tolyandre/elo-web-service/pkg/configuration"
)

// BuildDSN returns a DSN string with password taken from ELO_WEB_SERVICE_POSTGRES_PASSWORD
func BuildDSN() (string, error) {
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
