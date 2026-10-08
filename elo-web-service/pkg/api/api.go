package api

import (
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/bgg"
	"github.com/tolyandre/elo-web-service/pkg/configuration"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/tesera"
)

type API struct {
	UserService        elo.IUserService
	GameService        elo.IGameService
	PlayerService      elo.IPlayerService
	MatchService       elo.IMatchService
	MarketService      elo.IMarketService
	MarketQueries      *db.Queries // read-side market queries for the handlers
	EloSettingsService elo.IEloSettingsService
	ClubService        elo.IClubService
	TenantService      elo.ITenantService
	TagService         elo.ITagService
	TableService       elo.ITableService
	AuditService       elo.IAuditService
	ArenaService       *elo.ArenaService
	TournamentService  *elo.TournamentService
	MatchQueries       *db.Queries // read-side arena matches queries for the handlers
	Hub                *elo.Hub
}

func New(pool *pgxpool.Pool) *API {
	// An empty token yields a nil client: BGG enrichment stays off. Log it
	// once at boot — a missing token otherwise surfaces only as an opaque
	// "unavailable" error when the enrich action is clicked.
	bggClient := bgg.NewClient("", configuration.Config.BggApiAccessToken)
	if bggClient == nil {
		log.Printf("bgg enrichment disabled: ELO_WEB_SERVICE_BGG_API_ACCESS_TOKEN is not set")
	}
	return NewWithClients(pool,
		tesera.NewClient(configuration.Config.TeseraBaseURL),
		bggClient)
}

// NewWithClients lets tests point the catalogue integrations (Tesera
// suggestions, BGG image enrichment) at stub servers instead of the real
// APIs; a nil client disables that integration.
func NewWithClients(pool *pgxpool.Pool, teseraClient *tesera.Client, bggClient *bgg.Client) *API {
	hub := elo.NewHub()
	marketService := elo.NewMarketServiceWithHub(pool, hub)
	arenaService := elo.NewArenaService(pool, hub)
	tournamentService := elo.NewTournamentService(pool, arenaService, marketService)
	matchService := elo.NewMatchService(pool, marketService, arenaService, tournamentService)
	// The arena updater's main-arena drain re-chains the market ledger through
	// the settlement sweep (ADR-36 phase 6); set after construction —
	// MatchService depends on ArenaService.
	arenaService.Sweep = matchService

	return &API{
		UserService:        elo.NewUserService(pool),
		GameService:        elo.NewGameService(pool, arenaService, teseraClient, bggClient),
		PlayerService:      elo.NewPlayerService(pool),
		MatchService:       matchService,
		MarketService:      marketService,
		MarketQueries:      db.New(pool),
		EloSettingsService: elo.NewEloSettingsService(pool),
		ClubService:        elo.NewClubService(pool),
		TenantService:      elo.NewTenantService(pool, arenaService, hub),
		TagService:         elo.NewTagService(pool, arenaService),
		TableService:       elo.NewTableService(pool, hub),
		AuditService:       elo.NewAuditService(pool),
		ArenaService:       arenaService,
		TournamentService:  tournamentService,
		MatchQueries:       db.New(pool),
		Hub:                hub,
	}
}

// NewWithTesera is NewWithClients without BGG, kept for the existing
// suggestion-focused tests.
func NewWithTesera(pool *pgxpool.Pool, teseraClient *tesera.Client) *API {
	return NewWithClients(pool, teseraClient, nil)
}
