//go:build integration

package integration_test

import (
	"context"
	"testing"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestTournament_Migration056RebuildEntity drives a fresh database to 055,
// shapes the pre-ADR-26 state (a camp-shell tournaments row plus a still-
// anchored arena, which 053 should have prevented but the migration defends
// against), migrates on, and verifies the rebuild: the shell row is deleted,
// the arena survives detached, and the widened audit constraints plus the new
// pure-expression membership function behave per ADR-26/28.
func TestTournament_Migration056RebuildEntity(t *testing.T) {
	ctx := context.Background()

	pool, dsn, cleanup := setupTestDBAtVersion(t, 55)
	defer cleanup()

	playerID := createTestPlayer(t, pool, "(Турнир) Миг")
	gameID := createTestGame(t, pool, "Миггра игра")
	shellID := idpkg.ID("00000000-0000-0000-0000-000000000099")
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, name) VALUES ($1, 'Старый кэмп-шелл')`, shellID); err != nil {
		t.Fatalf("insert legacy tournament: %v", err)
	}

	// A defensively detached arena: non-camp, so it needs a filter (053 CHECKs).
	filterID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO match_filters (id, date_from, date_to, game_ids, tag_ids)
		 VALUES ($1, NULL, NULL, $2, '{}')`, filterID, []idpkg.ID{gameID}); err != nil {
		t.Fatalf("insert filter: %v", err)
	}
	arenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, match_filter_id, settings, settings_schema_version, tournament_id, camp)
		 VALUES ($1, 'Арена старого кэмпа', $2, '{"starting_rating":900,"leagues":[]}', 1, $3, false)`,
		arenaID, filterID, shellID); err != nil {
		t.Fatalf("insert anchored arena: %v", err)
	}

	migrateToVersion(t, dsn, 0)

	// The shell row is gone; its name is reusable.
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM tournaments`).Scan(&count); err != nil {
		t.Fatalf("count tournaments: %v", err)
	}
	if count != 0 {
		t.Fatalf("tournaments must be empty after 056, got %d rows", count)
	}

	// The arena survived, detached from the deleted tournament, filter intact.
	var (
		name        string
		anchor      *idpkg.ID
		stillFilter *idpkg.ID
	)
	if err := pool.QueryRow(ctx,
		`SELECT name, tournament_id, match_filter_id FROM arenas WHERE id = $1`, arenaID,
	).Scan(&name, &anchor, &stillFilter); err != nil {
		t.Fatalf("arena lookup after migration: %v", err)
	}
	if name != "Арена старого кэмпа" || anchor != nil || stillFilter == nil {
		t.Fatalf("arena after 056: name=%q anchor=%v filter=%v", name, anchor, stillFilter)
	}

	// Players and games are untouched.
	var players int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM players WHERE id = $1`, playerID).Scan(&players); err != nil {
		t.Fatalf("player lookup: %v", err)
	}
	if players != 1 {
		t.Fatalf("player must survive the migration")
	}

	// The membership function: tournament branch first, then camp, then filter.
	matchID := newID(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO matches (id, date, game_id) VALUES ($1, NOW(), $2)`, matchID, gameID); err != nil {
		t.Fatalf("insert probe match: %v", err)
	}
	// A live (post-rebuild) tournament whose link table feeds the probe.
	tournID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, name, status, elimination) VALUES ($1, 'Миграционный турнир', 'running', 'single')`,
		tournID); err != nil {
		t.Fatalf("insert probe tournament: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournament_matches (tournament_id, match_id) VALUES ($1, $2)`, tournID, matchID); err != nil {
		t.Fatalf("insert probe link: %v", err)
	}
	cases := []struct {
		what  string
		query string
		args  []any
		want  bool
	}{
		{
			what: "tournament arena contains a linked match",
			query: `SELECT arena_contains_match(
				false, true,
				false,
				EXISTS (SELECT 1 FROM tournament_matches tm WHERE tm.tournament_id = $1 AND tm.match_id = $2),
				false, NOW(), $3, NULL, NULL, NULL, NULL)`,
			args: []any{tournID, matchID, gameID},
			want: true,
		},
		{
			what: "tournament arena ignores the filter (NULL filter matches nothing)",
			query: `SELECT arena_contains_match(
				false, true,
				false,
				false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: false,
		},
		{
			what: "camp arena still link-only",
			query: `SELECT arena_contains_match(
				true, false,
				true,
				false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: true,
		},
		{
			what: "filter arena with an empty filter contains every match",
			query: `SELECT arena_contains_match(
				false, false,
				false, false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: true,
		},
	}
	for _, tc := range cases {
		var got bool
		if err := pool.QueryRow(ctx, tc.query, tc.args...).Scan(&got); err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		if got != tc.want {
			t.Fatalf("%s: got %v, want %v", tc.what, got, tc.want)
		}
	}

	// The widened audit constraints accept a tournament row with a NULL system
	// actor (the deadline auto-cancel shape, ADR-26).
	if _, err := pool.Exec(ctx,
		`INSERT INTO audit_log (id, actor_user_id, entity_type, entity_id, action, details_kind, details_schema_version, details)
		 VALUES ($1, NULL, 'tournament', $2, 'updated', 'tournament-state', 1, '{"schema_version":1,"from":"running","to":"cancelled","reason":"deadline"}'::jsonb)`,
		idpkg.NewMonotonic(), shellID); err != nil {
		t.Fatalf("insert tournament audit row: %v", err)
	}
}
