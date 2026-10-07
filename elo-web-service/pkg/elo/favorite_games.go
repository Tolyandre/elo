package elo

import (
	"context"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// The game picker's «Избранные» tab (GET /games/favorites).

// FavoriteGamesLimit caps each section («Недавние», «Популярные») of the
// favorites response; the frontend mirrors it as FAVORITE_GAMES_LIMIT.
const FavoriteGamesLimit = 7

// RecentGame is one entry of the «Недавние» section: a game plus the date of
// its most recent match among the ones the current user's player or a member
// of their clubs took part in.
type RecentGame struct {
	GameID   id.ID
	RecentAt time.Time
}

// PopularGame is one entry of the «Популярные» section: a game plus how many
// matches of the current user's clubs (or globally, for users without a club)
// it appears in.
type PopularGame struct {
	GameID     id.ID
	MatchCount int64
}

// FavoriteGames is the two-section payload of the game picker's favorites.
type FavoriteGames struct {
	Recent  []RecentGame
	Popular []PopularGame
}

// ListFavoriteGames assembles the favorite games for the current user:
//   - «Недавние»: games recently played by the user's player or by a member
//     of any of their clubs, most recent match first,
//   - «Популярные»: games most played by members of their clubs; users whose
//     player belongs to no club fall back to the globally most played games.
//
// Popular excludes games already listed as recent; each section holds at most
// `limit` entries.
func (s *GameService) ListFavoriteGames(ctx context.Context, userID id.ID, limit int) (FavoriteGames, error) {
	me, err := s.Queries.GetUser(ctx, userID)
	if err != nil {
		return FavoriteGames{}, err
	}

	var myPlayerID *id.ID
	var clubIDs []id.ID
	if me.PlayerID != nil {
		pid := *me.PlayerID
		myPlayerID = &pid
		clubIDs, err = s.Queries.ListClubIDsByPlayerID(ctx, *me.PlayerID)
		if err != nil {
			return FavoriteGames{}, err
		}
	}

	// Recent games need at least one seed (my player or a club); without any
	// there is nothing to match, so the query is skipped entirely.
	var recent []RecentGame
	if myPlayerID != nil || len(clubIDs) > 0 {
		rows, err := s.Queries.ListRecentGames(ctx, db.ListRecentGamesParams{
			MyPlayerID: myPlayerID,
			ClubIds:    clubIDs,
			Limit:      int32(limit),
		})
		if err != nil {
			return FavoriteGames{}, err
		}
		recent = make([]RecentGame, 0, len(rows))
		for _, r := range rows {
			recent = append(recent, RecentGame{GameID: r.GameID, RecentAt: r.LastMatchAt})
		}
	}

	var popular []PopularGame
	if len(clubIDs) > 0 {
		rows, err := s.Queries.ListPopularClubGames(ctx, db.ListPopularClubGamesParams{
			ClubIds: clubIDs,
			// Some of the most played games may already sit in «Недавние»;
			// fetch enough rows so the section still fills up after the dedup.
			Limit: int32(limit + len(recent)),
		})
		if err != nil {
			return FavoriteGames{}, err
		}
		popular = make([]PopularGame, 0, len(rows))
		for _, r := range rows {
			popular = append(popular, PopularGame{GameID: r.GameID, MatchCount: r.MatchCount})
		}
	} else {
		// No club — fall back to the globally most played games so the
		// «Популярные» section stays useful.
		rows, err := s.Queries.ListPopularGamesGlobal(ctx, int32(limit))
		if err != nil {
			return FavoriteGames{}, err
		}
		popular = make([]PopularGame, 0, len(rows))
		for _, r := range rows {
			popular = append(popular, PopularGame{GameID: r.GameID, MatchCount: r.MatchCount})
		}
	}

	return mergeFavoriteGames(recent, popular, limit), nil
}

// mergeFavoriteGames trims recent to limit and rebuilds popular without the
// games already listed as recent, trimmed to limit. Pure, so the ordering and
// dedup rules are unit-tested directly.
func mergeFavoriteGames(recent []RecentGame, popular []PopularGame, limit int) FavoriteGames {
	if len(recent) > limit {
		recent = recent[:limit]
	}
	recentIDs := make(map[id.ID]struct{}, len(recent))
	for _, r := range recent {
		recentIDs[r.GameID] = struct{}{}
	}

	trimmed := make([]PopularGame, 0, min(limit, len(popular)))
	for _, p := range popular {
		if len(trimmed) >= limit {
			break
		}
		if _, ok := recentIDs[p.GameID]; ok {
			continue
		}
		trimmed = append(trimmed, p)
	}

	return FavoriteGames{Recent: recent, Popular: trimmed}
}
