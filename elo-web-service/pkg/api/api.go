package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type API struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *API {
	return &API{
		Queries: db.New(pool),
		Pool:    pool,
	}
}
