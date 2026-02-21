package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type API struct {
	UserService   elo.IUserService
	GameService   elo.IGameService
	PlayerService elo.IPlayerService
	MatchService  elo.IMatchService
	Queries       *db.Queries
	Pool          *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *API {
	return &API{
		UserService:   elo.NewUserService(pool),
		GameService:   elo.NewGameService(pool),
		PlayerService: elo.NewPlayerService(pool),
		MatchService:  elo.NewMatchService(pool),
		Queries:       db.New(pool),
		Pool:          pool,
	}
}
