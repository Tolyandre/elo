package db

import (
	"errors"

	"github.com/jackc/pgx/v5"
)

func NotFound(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
