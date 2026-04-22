package api

import (
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	skullking "github.com/tolyandre/elo-web-service/pkg/cardrecognition/skull-king"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type API struct {
	UserService           elo.IUserService
	GameService           elo.IGameService
	PlayerService         elo.IPlayerService
	MatchService          elo.IMatchService
	MarketService         elo.IMarketService
	ClubService           elo.IClubService
	SkullKingTableService elo.ISkullKingTableService
	SkullKingHub          *elo.SkullKingHub
	CardRecognizer        *skullking.Recognizer
	Queries               *db.Queries
	Pool                  *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *API {
	marketService := elo.NewMarketService(pool)
	skullKingHub := elo.NewSkullKingHub()

	recognizerCfg := skullking.DefaultConfig()
	if cfg.Config.SkullKingConfidenceThreshold > 0 {
		recognizerCfg.ConfidenceThreshold = cfg.Config.SkullKingConfidenceThreshold
	}
	recognizer, err := skullking.NewRecognizer(recognizerCfg)
	if err != nil {
		log.Fatalf("failed to initialize card recognizer: %v", err)
	}

	return &API{
		UserService:           elo.NewUserService(pool),
		GameService:           elo.NewGameService(pool),
		PlayerService:         elo.NewPlayerService(pool),
		MatchService:          elo.NewMatchService(pool, marketService),
		MarketService:         marketService,
		ClubService:           elo.NewClubService(pool),
		SkullKingHub:          skullKingHub,
		SkullKingTableService: elo.NewSkullKingTableService(pool, skullKingHub),
		CardRecognizer:        recognizer,
		Queries:               db.New(pool),
		Pool:                  pool,
	}
}
