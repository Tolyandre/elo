package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

type OAUTH2 struct {
	Queries     *db.Queries
	Pool        *pgxpool.Pool
	UserService elo.IUserService
}

func New(pool *pgxpool.Pool) *OAUTH2 {
	return &OAUTH2{
		Queries:     db.New(pool),
		Pool:        pool,
		UserService: elo.NewUserService(pool),
	}
}
