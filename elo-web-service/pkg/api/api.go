package api

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/configuration"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type API struct {
	UserService           elo.IUserService
	GameService           elo.IGameService
	PlayerService         elo.IPlayerService
	MatchService          elo.IMatchService
	MarketService         elo.IMarketService
	CorrectionService     elo.ICorrectionService
	EloSettingsService    elo.IEloSettingsService
	ClubService           elo.IClubService
	TournamentService     elo.ITournamentService
	SkullKingTableService elo.ISkullKingTableService
	SkullKingHub          *elo.SkullKingHub
	CardRecognizer        ICardRecognizer
	VoiceParser           *VoiceParser
}

func New(pool *pgxpool.Pool) *API {
	marketService := elo.NewMarketService(pool)
	skullKingHub := elo.NewSkullKingHub()

	return &API{
		UserService:           elo.NewUserService(pool),
		GameService:           elo.NewGameService(pool),
		PlayerService:         elo.NewPlayerService(pool),
		MatchService:          elo.NewMatchService(pool, marketService),
		MarketService:         marketService,
		CorrectionService:     elo.NewCorrectionService(pool),
		EloSettingsService:    elo.NewEloSettingsService(pool),
		ClubService:           elo.NewClubService(pool),
		TournamentService:     elo.NewTournamentService(pool),
		SkullKingHub:          skullKingHub,
		SkullKingTableService: elo.NewSkullKingTableService(pool, skullKingHub),
		CardRecognizer:        newCardRecognizer(),
		VoiceParser:           NewVoiceParser(configuration.Config.OllamaBaseUrl, configuration.Config.OllamaModel),
	}
}
