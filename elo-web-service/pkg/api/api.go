package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type API struct {
	UserService        elo.IUserService
	GameService        elo.IGameService
	PlayerService      elo.IPlayerService
	MatchService       elo.IMatchService
	MarketService      elo.IMarketService
	CorrectionService  elo.ICorrectionService
	EloSettingsService elo.IEloSettingsService
	ClubService        elo.IClubService
	TournamentService  elo.ITournamentService
	TableService       elo.ITableService
	AuditService       elo.IAuditService
	Hub                *elo.Hub
}

func New(pool *pgxpool.Pool) *API {
	hub := elo.NewHub()
	marketService := elo.NewMarketServiceWithHub(pool, hub)

	return &API{
		UserService:        elo.NewUserService(pool),
		GameService:        elo.NewGameService(pool),
		PlayerService:      elo.NewPlayerService(pool),
		MatchService:       elo.NewMatchService(pool, marketService),
		MarketService:      marketService,
		CorrectionService:  elo.NewCorrectionService(pool),
		EloSettingsService: elo.NewEloSettingsService(pool),
		ClubService:        elo.NewClubService(pool),
		TournamentService:  elo.NewTournamentService(pool),
		TableService:       elo.NewTableService(pool, hub),
		AuditService:       elo.NewAuditService(pool),
		Hub:                hub,
	}
}
