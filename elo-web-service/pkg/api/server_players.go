package api

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (s *StrictServer) ListPlayers(ctx context.Context, _ ListPlayersRequestObject) (ListPlayersResponseObject, error) {
	now := time.Now()
	tDay := now.Add(-time.Hour * 12)
	tWeek := now.Add(-time.Hour * (24*7 - 12))

	actualPlayers, err := s.api.PlayerService.GetPlayersWithRank(ctx, nil)
	if err != nil {
		return nil, err
	}
	dayAgoPlayers, err := s.api.PlayerService.GetPlayersWithRank(ctx, &tDay)
	if err != nil {
		return nil, err
	}
	weekAgoPlayers, err := s.api.PlayerService.GetPlayersWithRank(ctx, &tWeek)
	if err != nil {
		return nil, err
	}

	userLinks, err := s.api.PlayerService.ListPlayerUserLinks(ctx)
	if err != nil {
		return nil, err
	}
	playerUserMap := make(map[int32]string, len(userLinks))
	for _, link := range userLinks {
		if link.PlayerID.Valid {
			playerUserMap[link.PlayerID.Int32] = fmt.Sprintf("%d", link.UserID)
		}
	}

	dbPlayers, err := s.api.PlayerService.ListPlayers(ctx)
	if err != nil {
		return nil, err
	}
	geologistNameMap := make(map[int32]string, len(dbPlayers))
	for _, dp := range dbPlayers {
		if dp.GeologistName.Valid {
			geologistNameMap[dp.ID] = dp.GeologistName.String
		}
	}

	result := make([]Player, 0, len(actualPlayers))
	for _, p := range actualPlayers {
		dayAgo := findPlayer(dayAgoPlayers, p.ID)
		weekAgo := findPlayer(weekAgoPlayers, p.ID)

		var userID *string
		var geologistName *string
		if idInt, err := strconv.Atoi(p.ID); err == nil {
			if uid, ok := playerUserMap[int32(idInt)]; ok {
				userID = &uid
			}
			if gn, ok := geologistNameMap[int32(idInt)]; ok {
				geologistName = &gn
			}
		}

		result = append(result, Player{
			Id:            p.ID,
			Name:          p.Name,
			GeologistName: geologistName,
			UserId:        userID,
			Rank: HistoryRank{
				Now: EloRank{
					Elo:                  p.Elo,
					Rank:                 p.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				DayAgo: EloRank{
					Elo:                  dayAgo.Elo,
					Rank:                 dayAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				WeekAgo: EloRank{
					Elo:                  weekAgo.Elo,
					Rank:                 weekAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
			},
		})
	}

	return ListPlayers200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) CreatePlayer(ctx context.Context, request CreatePlayerRequestObject) (CreatePlayerResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreatePlayer400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	player, err := s.api.PlayerService.CreatePlayer(ctx, name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreatePlayer409JSONResponse{Status: "fail", Message: "player with this name already exists"}, nil
		}
		return nil, err
	}

	return CreatePlayer200JSONResponse{
		Status: "success",
		Data: PlayerRef{
			Id:   strconv.Itoa(int(player.ID)),
			Name: player.Name,
		},
	}, nil
}

func (s *StrictServer) PatchPlayer(ctx context.Context, request PatchPlayerRequestObject) (PatchPlayerResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return PatchPlayer400JSONResponse{Status: "fail", Message: "invalid player id"}, nil
	}

	name := request.Body.Name
	if name == "" {
		return PatchPlayer400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	player, err := s.api.PlayerService.UpdatePlayer(ctx, int32(idInt), name)
	if db.IsNoRows(err) {
		return PatchPlayer404JSONResponse{Status: "fail", Message: "player not found"}, nil
	}
	if err != nil {
		if db.IsUniqueViolation(err) {
			return PatchPlayer409JSONResponse{Status: "fail", Message: "player with this name already exists"}, nil
		}
		return nil, err
	}

	return PatchPlayer200JSONResponse{
		Status: "success",
		Data: PlayerRef{
			Id:   strconv.Itoa(int(player.ID)),
			Name: player.Name,
		},
	}, nil
}

func (s *StrictServer) DeletePlayer(ctx context.Context, request DeletePlayerRequestObject) (DeletePlayerResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return DeletePlayer400JSONResponse{Status: "fail", Message: "invalid player id"}, nil
	}

	err = s.api.PlayerService.DeletePlayer(ctx, int32(idInt))
	if db.IsNoRows(err) {
		return DeletePlayer404JSONResponse{Status: "fail", Message: "player not found"}, nil
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			return DeletePlayer400JSONResponse{Status: "fail", Message: "cannot delete player with matches"}, nil
		}
		return nil, err
	}

	return DeletePlayer200JSONResponse{Status: "success", Message: "Player deleted"}, nil
}

func (s *StrictServer) GetPlayerStats(ctx context.Context, request GetPlayerStatsRequestObject) (GetPlayerStatsResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return GetPlayerStats400JSONResponse{Status: "fail", Message: "invalid player id"}, nil
	}
	playerID := int32(idInt)

	player, err := s.api.PlayerService.GetPlayer(ctx, playerID)
	if err != nil {
		if db.IsNoRows(err) {
			return GetPlayerStats404JSONResponse{Status: "fail", Message: "player not found"}, nil
		}
		return nil, err
	}

	ratingRows, err := s.api.PlayerService.RatingHistory(ctx, playerID)
	if err != nil {
		return nil, err
	}
	ratingHistory := make([]RatingPoint, 0, len(ratingRows))
	for _, r := range ratingRows {
		if r.Date.Valid {
			ratingHistory = append(ratingHistory, RatingPoint{
				Date:   r.Date.Time.UTC(),
				Rating: r.Rating,
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
			Wins:         int(g.Wins),
		})
	}

	eloStats, err := s.api.PlayerService.GetPlayerGameEloStats(ctx, playerID)
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
		Status: "success",
		Data: PlayerStats{
			PlayerName:            player.Name,
			RatingHistory:         ratingHistory,
			TopGamesByMatches:     topGamesByMatches,
			TopGamesByEloEarned:   topGamesByElo,
			WorstGamesByEloEarned: worstGamesByElo,
		},
	}, nil
}

