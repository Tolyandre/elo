package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type API struct {
	UserService        elo.IUserService
	GameService        elo.IGameService
	PlayerService      elo.IPlayerService
	MatchService       elo.IMatchService
	MarketService      elo.IMarketService
	MarketQueries      *db.Queries // read-side market queries for the handlers
	CorrectionService  elo.ICorrectionService
	EloSettingsService elo.IEloSettingsService
	ClubService        elo.IClubService
	TagService         elo.ITagService
	TableService       elo.ITableService
	AuditService       elo.IAuditService
	ArenaService       *elo.ArenaService
	TournamentService  *elo.TournamentService
	MatchQueries       *db.Queries // read-side arena matches queries for the handlers
	Hub                *elo.Hub
}

func New(pool *pgxpool.Pool) *API {
	hub := elo.NewHub()
	marketService := elo.NewMarketServiceWithHub(pool, hub)
	arenaService := elo.NewArenaService(pool, hub)
	tournamentService := elo.NewTournamentService(pool, arenaService, marketService)

	return &API{
		UserService:        elo.NewUserService(pool),
		GameService:        elo.NewGameService(pool, arenaService),
		PlayerService:      elo.NewPlayerService(pool),
		MatchService:       elo.NewMatchService(pool, marketService, arenaService, tournamentService),
		MarketService:      marketService,
		MarketQueries:      db.New(pool),
		CorrectionService:  elo.NewCorrectionService(pool, arenaService),
		EloSettingsService: elo.NewEloSettingsService(pool),
		ClubService:        elo.NewClubService(pool),
		TagService:         elo.NewTagService(pool, arenaService),
		TableService:       elo.NewTableService(pool, hub),
		AuditService:       elo.NewAuditService(pool),
		ArenaService:       arenaService,
		TournamentService:  tournamentService,
		MatchQueries:       db.New(pool),
		Hub:                hub,
	}
}
