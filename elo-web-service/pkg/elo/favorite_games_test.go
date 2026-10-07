package elo

import (
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

func recentGame(gameID id.ID, daysAgo int) RecentGame {
	return RecentGame{GameID: gameID, RecentAt: base.Add(-time.Duration(daysAgo) * day)}
}

func popularGame(gameID id.ID, count int64) PopularGame {
	return PopularGame{GameID: gameID, MatchCount: count}
}

func TestMergeFavoriteGames_DropsPopularAlreadyRecent(t *testing.T) {
	// "Both" is among the recent games and must not repeat in popular;
	// the popular order (by play count) is otherwise preserved.
	got := mergeFavoriteGames(
		[]RecentGame{recentGame("both", 1), recentGame("other", 2)},
		[]PopularGame{popularGame("top", 30), popularGame("both", 20), popularGame("low", 5)},
		7)

	if len(got.Recent) != 2 || got.Recent[0].GameID != "both" {
		t.Fatalf("expected recent [both other], got %+v", got.Recent)
	}
	if len(got.Popular) != 2 || got.Popular[0].GameID != "top" || got.Popular[1].GameID != "low" {
		t.Fatalf("expected popular [top low] without the recent game, got %+v", got.Popular)
	}
}

func TestMergeFavoriteGames_TrimsBothSections(t *testing.T) {
	var recent []RecentGame
	var popular []PopularGame
	for i := 0; i < 10; i++ {
		recent = append(recent, recentGame(id.ID(string(rune('a'+i))), i+1))
		popular = append(popular, popularGame(id.ID(string(rune('A'+i))), int64(100-i)))
	}
	got := mergeFavoriteGames(recent, popular, 7)

	if len(got.Recent) != 7 {
		t.Fatalf("expected 7 recent entries, got %d", len(got.Recent))
	}
	if len(got.Popular) != 7 {
		t.Fatalf("expected 7 popular entries, got %d", len(got.Popular))
	}
}

func TestMergeFavoriteGames_EmptyRecentKeepsPopular(t *testing.T) {
	got := mergeFavoriteGames(nil, []PopularGame{popularGame("top", 3)}, 7)
	if len(got.Recent) != 0 {
		t.Fatalf("expected empty recent, got %+v", got.Recent)
	}
	if len(got.Popular) != 1 || got.Popular[0].GameID != "top" {
		t.Fatalf("expected popular [top], got %+v", got.Popular)
	}
}
