package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

func (s *StrictServer) ListPlayers(ctx context.Context, request ListPlayersRequestObject) (ListPlayersResponseObject, error) {
	// The catalog is global — names load without a tenant, so the name
	// lookups (tournament brackets, arena feeds, match cards) resolve on
	// pages opened by a direct link (ADR-36 phase 7). The ranking columns
	// stay tenant-scoped (ADR-36 phase 5): present only when ?tenant= names
	// an existing tenant.
	arenaID := id.ID("")
	if request.Params.Tenant != nil && *request.Params.Tenant != "" {
		var err error
		arenaID, err = s.resolveDisplayArena(ctx, *request.Params.Tenant)
		if err != nil {
			if db.IsNoRows(err) {
				return ListPlayers404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
			}
			return nil, err
		}
	}

	// Ranking reads happen only for the tenant-scoped variant. The rank-change
	// points are indexed once instead of a linear scan per player.
	var actualPlayers []elo.Player
	var dayAgoByID, weekAgoByID map[id.ID]elo.Player
	if !arenaID.IsZero() {
		now := time.Now()
		tDay := now.Add(-time.Hour * 12)
		tWeek := now.Add(-time.Hour * (24*7 - 12))

		var err error
		actualPlayers, err = s.api.PlayerService.GetPlayersWithRank(ctx, arenaID, nil)
		if err != nil {
			return nil, err
		}
		var dayAgoPlayers, weekAgoPlayers []elo.Player
		dayAgoPlayers, err = s.api.PlayerService.GetPlayersWithRank(ctx, arenaID, &tDay)
		if err != nil {
			return nil, err
		}
		weekAgoPlayers, err = s.api.PlayerService.GetPlayersWithRank(ctx, arenaID, &tWeek)
		if err != nil {
			return nil, err
		}
		dayAgoByID = make(map[id.ID]elo.Player, len(dayAgoPlayers))
		for _, p := range dayAgoPlayers {
			dayAgoByID[p.ID] = p
		}
		weekAgoByID = make(map[id.ID]elo.Player, len(weekAgoPlayers))
		for _, p := range weekAgoPlayers {
			weekAgoByID[p.ID] = p
		}
	}

	userLinks, err := s.api.PlayerService.ListPlayerUserLinks(ctx)
	if err != nil {
		return nil, err
	}
	playerUserMap := make(map[id.ID]id.ID, len(userLinks))
	for _, link := range userLinks {
		if link.PlayerID != nil {
			playerUserMap[*link.PlayerID] = link.UserID
		}
	}

	dbPlayers, err := s.api.PlayerService.ListPlayers(ctx)
	if err != nil {
		return nil, err
	}
	geologistNameMap := make(map[string]string, len(dbPlayers))
	for _, dp := range dbPlayers {
		if dp.GeologistName.Valid {
			geologistNameMap[string(dp.ID)] = dp.GeologistName.String
		}
	}

	// Without a tenant the catalog iterates the plain db rows: names, links
	// and club data — no `rank` in the response.
	if arenaID.IsZero() {
		result := make([]Player, 0, len(dbPlayers))
		for _, p := range dbPlayers {
			var userID *id.ID
			var geologistName *string
			if uid, ok := playerUserMap[p.ID]; ok {
				userID = &uid
			}
			if gn, ok := geologistNameMap[string(p.ID)]; ok {
				geologistName = &gn
			}
			result = append(result, Player{
				Id:            p.ID,
				Name:          p.Name,
				GeologistName: geologistName,
				UserId:        userID,
			})
		}
		return ListPlayers200JSONResponse{Status: StatusSuccess, Data: result}, nil
	}

	result := make([]Player, 0, len(actualPlayers))
	for _, p := range actualPlayers {
		dayAgo := dayAgoByID[p.ID]
		weekAgo := weekAgoByID[p.ID]

		var userID *id.ID
		var geologistName *string
		if uid, ok := playerUserMap[p.ID]; ok {
			userID = &uid
		}
		if gn, ok := geologistNameMap[string(p.ID)]; ok {
			geologistName = &gn
		}

		var matchesLeftForElite *int
		if p.League == "amateur" && p.MatchesLeftForElite > 0 {
			v := p.MatchesLeftForElite
			matchesLeftForElite = &v
		}

		var winsNeededForAmateur, winsNeededForAmateurUpper *int
		if p.League == "newbie" && p.WinsNeededForAmateurLower > 0 {
			v := p.WinsNeededForAmateurLower
			winsNeededForAmateur = &v
		}
		if p.League == "newbie" && p.WinsNeededForAmateurUpper > 0 {
			v := p.WinsNeededForAmateurUpper
			winsNeededForAmateurUpper = &v
		}

		result = append(result, Player{
			Id:            p.ID,
			Name:          p.Name,
			GeologistName: geologistName,
			UserId:        userID,
			Rank: &HistoryRank{
				Now: EloRank{
					Rating:                    p.Elo,
					League:                    EloRankLeague(p.League),
					Rank:                      p.Rank,
					MatchesLeftForElite:       matchesLeftForElite,
					WinsNeededForAmateur:      winsNeededForAmateur,
					WinsNeededForAmateurUpper: winsNeededForAmateurUpper,
				},
				DayAgo: EloRank{
					Rating: dayAgo.Elo,
					League: EloRankLeague(dayAgo.League),
					Rank:   dayAgo.Rank,
				},
				WeekAgo: EloRank{
					Rating: weekAgo.Elo,
					League: EloRankLeague(weekAgo.League),
					Rank:   weekAgo.Rank,
				},
			},
		})
	}

	return ListPlayers200JSONResponse{Status: StatusSuccess, Data: result}, nil
}

func (s *StrictServer) ListRecentPlayers(ctx context.Context, _ ListRecentPlayersRequestObject) (ListRecentPlayersResponseObject, error) {
	user, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}

	recents, err := s.api.PlayerService.ListRecentPlayers(ctx, user.ID, elo.RecentPlayersLimit)
	if err != nil {
		return nil, err
	}

	data := make([]RecentPlayer, 0, len(recents))
	for _, r := range recents {
		var recentAt *time.Time
		if !r.RecentAt.IsZero() {
			t := r.RecentAt.UTC()
			recentAt = &t
		}
		data = append(data, RecentPlayer{
			Id:       r.Player.ID,
			Name:     r.Player.Name,
			RecentAt: recentAt,
		})
	}

	return ListRecentPlayers200JSONResponse{Status: StatusSuccess, Data: data}, nil
}

func (s *StrictServer) CreatePlayer(ctx context.Context, request CreatePlayerRequestObject) (CreatePlayerResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreatePlayer400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	player, err := s.api.PlayerService.CreatePlayer(ctx, request.Body.Id, name, currentActorID(ctx))
	if err != nil {
		if domainStatusCode(err) == http.StatusConflict {
			return CreatePlayer409JSONResponse{Status: StatusFail, Message: "player with this name already exists"}, nil
		}
		return nil, err
	}

	s.api.broadcastDataChange(false, true)

	return CreatePlayer200JSONResponse{
		Status: StatusSuccess,
		Data: PlayerRef{
			Id:   player.ID,
			Name: player.Name,
		},
	}, nil
}

func (s *StrictServer) PatchPlayer(ctx context.Context, request PatchPlayerRequestObject) (PatchPlayerResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return PatchPlayer400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	player, err := s.api.PlayerService.UpdatePlayer(ctx, parseIDParam(request.Id), name, currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return PatchPlayer404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
	case domainStatusCode(err) == http.StatusConflict:
		return PatchPlayer409JSONResponse{Status: StatusFail, Message: "player with this name already exists"}, nil
	default:
		return nil, err
	}

	s.api.broadcastDataChange(false, true)

	return PatchPlayer200JSONResponse{
		Status: StatusSuccess,
		Data: PlayerRef{
			Id:   player.ID,
			Name: player.Name,
		},
	}, nil
}

func (s *StrictServer) DeletePlayer(ctx context.Context, request DeletePlayerRequestObject) (DeletePlayerResponseObject, error) {
	_, err := s.api.PlayerService.DeletePlayer(ctx, parseIDParam(request.Id), currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return DeletePlayer404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
	case domainStatusCode(err) == http.StatusBadRequest:
		return DeletePlayer400JSONResponse{Status: StatusFail, Message: "cannot delete player with matches"}, nil
	default:
		return nil, err
	}

	s.api.broadcastDataChange(false, true)

	return DeletePlayer200JSONResponse{Status: StatusSuccess, Message: "Player deleted"}, nil
}

func (s *StrictServer) GetPlayerStats(ctx context.Context, request GetPlayerStatsRequestObject) (GetPlayerStatsResponseObject, error) {
	playerID := parseIDParam(request.Id)

	player, err := s.api.PlayerService.GetPlayer(ctx, playerID)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return GetPlayerStats404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
		}
		return nil, err
	}

	// The display arena for the rating history and the Elo-per-game tables:
	// the ?tenant='s main arena (ADR-36) — required since phase 5, reads are
	// tenant-scoped. "Частые игры" is tenant-independent and reads no arena at
	// all.
	arenaID, err := s.resolveDisplayArena(ctx, request.Params.Tenant)
	if err != nil {
		if errors.Is(err, errTenantRequired) {
			return GetPlayerStats400JSONResponse{Status: StatusFail, Message: "tenant query parameter is required"}, nil
		}
		if db.IsNoRows(err) {
			return GetPlayerStats404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
		}
		return nil, err
	}

	ratingRows, err := s.api.PlayerService.RatingHistory(ctx, playerID, arenaID)
	if err != nil {
		return nil, err
	}
	ratingHistory := make([]RatingPoint, 0, len(ratingRows))
	for _, r := range ratingRows {
		if r.Date.Valid {
			ratingHistory = append(ratingHistory, RatingPoint{
				Date:   r.Date.Time.UTC(),
				Rating: r.Rating,
				Elo:    r.Elo,
			})
		}
	}

	gameStats, err := s.api.PlayerService.GetPlayerGameStats(ctx, playerID)
	if err != nil {
		return nil, err
	}
	topGamesByMatches := make([]GameMatchStat, 0, len(gameStats))
	for _, g := range gameStats {
		topGamesByMatches = append(topGamesByMatches, GameMatchStat{
			GameId:       g.GameID,
			GameName:     g.GameName,
			MatchesCount: int(g.MatchesCount),
			GoldCount:    int(g.GoldCount),
			SilverCount:  int(g.SilverCount),
			BronzeCount:  int(g.BronzeCount),
		})
	}

	eloStats, err := s.api.PlayerService.GetPlayerGameEloStats(ctx, playerID, arenaID)
	if err != nil {
		return nil, err
	}

	limit := 10
	topGamesByElo := make([]GameEloStat, 0, limit)
	for i, g := range eloStats {
		if i >= limit {
			break
		}
		topGamesByElo = append(topGamesByElo, GameEloStat{
			GameId:    g.GameID,
			GameName:  g.GameName,
			EloEarned: g.EloEarned,
		})
	}

	worstGamesByElo := make([]GameEloStat, 0, limit)
	start := len(eloStats) - limit
	if start < 0 {
		start = 0
	}
	for i := len(eloStats) - 1; i >= start; i-- {
		g := eloStats[i]
		worstGamesByElo = append(worstGamesByElo, GameEloStat{
			GameId:    g.GameID,
			GameName:  g.GameName,
			EloEarned: g.EloEarned,
		})
	}

	return GetPlayerStats200JSONResponse{
		Status: StatusSuccess,
		Data: PlayerStats{
			PlayerName:            player.Name,
			RatingHistory:         ratingHistory,
			TopGamesByMatches:     topGamesByMatches,
			TopGamesByEloEarned:   topGamesByElo,
			WorstGamesByEloEarned: worstGamesByElo,
		},
	}, nil
}

// ---------------------------------------------------------------------------
// Player game collection ("Коллекция игр").
// ---------------------------------------------------------------------------

// collectionResponse loads the current collection for a response payload —
// the writes return the updated collection so the client refreshes in one
// round trip.
func (s *StrictServer) collectionResponse(ctx context.Context, playerID id.ID) (PlayerGameCollection, error) {
	games, total, err := s.api.PlayerService.ListPlayerGameCollection(ctx, playerID)
	if err != nil {
		return PlayerGameCollection{}, err
	}
	out := make([]PlayerCollectionGame, 0, len(games))
	for _, g := range games {
		var thumb *string
		if g.ImageThumbUrl.Valid {
			v := g.ImageThumbUrl.String
			thumb = &v
		}
		out = append(out, PlayerCollectionGame{Id: g.ID, Name: g.Name, ImageThumbUrl: thumb, MatchesCount: int(g.MatchesCount)})
	}
	return PlayerGameCollection{Total: total, Games: out}, nil
}

// requireCollectionManager authorizes a collection write: only the user linked
// to the target player (users.player_id) manages their shelf — not editors,
// not other users. A missing session maps to the typed 401; the wrong user to
// the 403-carrying domain error.
func (s *StrictServer) requireCollectionManager(ctx context.Context, playerID id.ID) error {
	user, err := s.requireUser(ctx)
	if err != nil {
		return err
	}
	if user.PlayerID == nil || *user.PlayerID != playerID {
		return elo.ErrPlayerCollectionForbidden
	}
	return nil
}

func (s *StrictServer) GetPlayerGameCollection(ctx context.Context, request GetPlayerGameCollectionRequestObject) (GetPlayerGameCollectionResponseObject, error) {
	playerID := parseIDParam(request.Id)
	if _, err := s.api.PlayerService.GetPlayer(ctx, playerID); err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return GetPlayerGameCollection404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
		}
		return nil, err
	}

	collection, err := s.collectionResponse(ctx, playerID)
	if err != nil {
		return nil, err
	}

	return GetPlayerGameCollection200JSONResponse{Status: StatusSuccess, Data: collection}, nil
}

func (s *StrictServer) AddPlayerGame(ctx context.Context, request AddPlayerGameRequestObject) (AddPlayerGameResponseObject, error) {
	playerID := parseIDParam(request.Id)
	// Existence first (the public GET 404s unknown players, so this leaks
	// nothing): an unknown player is a 404, not a 403-for-strangers or an FK
	// 400; after this the only possible FK violation is the game id.
	if _, err := s.api.PlayerService.GetPlayer(ctx, playerID); err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return AddPlayerGame404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
		}
		return nil, err
	}
	if err := s.requireCollectionManager(ctx, playerID); err != nil {
		if err == errAuthRequired {
			return AddPlayerGame401JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		if domainStatusCode(err) == http.StatusForbidden {
			return AddPlayerGame403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}

	if err := s.api.PlayerService.AddPlayerGame(ctx, playerID, request.Body.GameId); err != nil {
		if domainStatusCode(err) == http.StatusBadRequest {
			return AddPlayerGame400JSONResponse{Status: StatusFail, Message: "game not found"}, nil
		}
		return nil, err
	}

	s.api.broadcastDataChange(false, true)

	collection, err := s.collectionResponse(ctx, playerID)
	if err != nil {
		return nil, err
	}
	return AddPlayerGame200JSONResponse{Status: StatusSuccess, Data: collection}, nil
}

func (s *StrictServer) RemovePlayerGame(ctx context.Context, request RemovePlayerGameRequestObject) (RemovePlayerGameResponseObject, error) {
	playerID := parseIDParam(request.Id)
	// A missing player still 404s (the join-table delete of a nonexistent
	// player is a silent no-op otherwise); a missing game entry is a no-op.
	if _, err := s.api.PlayerService.GetPlayer(ctx, playerID); err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return RemovePlayerGame404JSONResponse{Status: StatusFail, Message: "player not found"}, nil
		}
		return nil, err
	}
	if err := s.requireCollectionManager(ctx, playerID); err != nil {
		if err == errAuthRequired {
			return RemovePlayerGame401JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		if domainStatusCode(err) == http.StatusForbidden {
			return RemovePlayerGame403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}

	if err := s.api.PlayerService.RemovePlayerGame(ctx, playerID, parseIDParam(request.GameId)); err != nil {
		return nil, err
	}

	s.api.broadcastDataChange(false, true)

	collection, err := s.collectionResponse(ctx, playerID)
	if err != nil {
		return nil, err
	}
	return RemovePlayerGame200JSONResponse{Status: StatusSuccess, Data: collection}, nil
}
