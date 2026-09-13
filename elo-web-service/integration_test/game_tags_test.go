//go:build integration

package integration_test

import (
	"context"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// TestTagLifecycleAndGameAttachment covers the tag vocabulary and its
// many-to-many attachment to games: create (idempotent replay), duplicate-name
// conflict, attach/detach (idempotent), delete with cascade of join rows, and
// the tags surfacing in the ordered games list.
func TestTagLifecycleAndGameAttachment(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	gameID := createTestGame(t, pool, "Тегированная игра")
	// A real user id: tag create/delete write audit events (entity_type 'tag'),
	// which also proves the audit_log CHECK constraint was widened.
	actor := createTestAdmin(t, pool)

	tagSvc := elo.NewTagService(pool)
	gameSvc := elo.NewGameService(pool)

	tag, err := tagSvc.CreateTag(ctx, newID(t), "кооператив", actor)
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}

	// Duplicate name → unique violation (mapped to 409 by the handler layer).
	_, err = tagSvc.CreateTag(ctx, newID(t), "кооператив", actor)
	if !db.IsUniqueViolation(err) {
		t.Fatalf("duplicate CreateTag: want unique violation, got %v", err)
	}

	// Idempotent replay with the same id must not fail.
	if _, err := tagSvc.CreateTag(ctx, tag.ID, "кооператив", actor); err != nil {
		t.Fatalf("idempotent CreateTag replay: %v", err)
	}

	// Attach is idempotent and shows up in the games list.
	if err := tagSvc.AddGameTag(ctx, gameID, tag.ID); err != nil {
		t.Fatalf("AddGameTag: %v", err)
	}
	if err := tagSvc.AddGameTag(ctx, gameID, tag.ID); err != nil {
		t.Fatalf("AddGameTag replay: %v", err)
	}

	// Rename applies everywhere and reports the real usage count.
	renamed, err := tagSvc.UpdateTagName(ctx, tag.ID, "семейная", actor)
	if err != nil {
		t.Fatalf("UpdateTagName: %v", err)
	}
	if renamed.Name != "семейная" || renamed.GameCount != 1 {
		t.Fatalf("renamed = %+v, want name=семейная game_count=1", renamed)
	}
	if _, err := tagSvc.UpdateTagName(ctx, tag.ID, "кооператив", actor); err != nil {
		t.Fatalf("rename back: %v", err)
	}

	// Renaming onto a name owned by another tag conflicts.
	if _, err := tagSvc.CreateTag(ctx, newID(t), "семейная", actor); err != nil {
		t.Fatalf("CreateTag second: %v", err)
	}
	if _, err := tagSvc.UpdateTagName(ctx, tag.ID, "семейная", actor); !db.IsUniqueViolation(err) {
		t.Fatalf("rename to existing: want unique violation, got %v", err)
	}

	titles, err := gameSvc.GetGameTitlesOrderedByLastPlayed(ctx)
	if err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	var tags []elo.TagRef
	for _, g := range titles {
		if g.Id == gameID {
			tags = g.Tags
		}
	}
	if len(tags) != 1 || tags[0].Id != tag.ID || tags[0].Name != "кооператив" {
		t.Fatalf("game tags = %v, want exactly [%s]", tags, tag.ID)
	}

	// ListTags reports the usage count.
	list, err := tagSvc.ListTags(ctx)
	if err != nil {
		t.Fatalf("ListTags: %v", err)
	}
	found := false
	for _, lt := range list {
		if lt.Id == tag.ID {
			found = true
			if lt.GameCount != 1 {
				t.Fatalf("tag game_count = %d, want 1", lt.GameCount)
			}
		}
	}
	if !found {
		t.Fatalf("tag %s missing from ListTags", tag.ID)
	}

	// Detach empties the game's tag list.
	if err := tagSvc.RemoveGameTag(ctx, gameID, tag.ID); err != nil {
		t.Fatalf("RemoveGameTag: %v", err)
	}
	titles, err = gameSvc.GetGameTitlesOrderedByLastPlayed(ctx)
	if err != nil {
		t.Fatalf("ListGames after detach: %v", err)
	}
	for _, g := range titles {
		if g.Id == gameID && len(g.Tags) != 0 {
			t.Fatalf("game tags after detach = %v, want empty", g.Tags)
		}
	}

	// Deleting the tag removes it even while detached from every game;
	// attaching it beforehand proves the cascade clears the join table.
	if err := tagSvc.AddGameTag(ctx, gameID, tag.ID); err != nil {
		t.Fatalf("AddGameTag before delete: %v", err)
	}
	if _, err := tagSvc.DeleteTag(ctx, tag.ID, actor); err != nil {
		t.Fatalf("DeleteTag: %v", err)
	}
	var joinCount int
	if err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM game_tag WHERE tag_id = $1", tag.ID).Scan(&joinCount); err != nil {
		t.Fatalf("count join rows: %v", err)
	}
	if joinCount != 0 {
		t.Fatalf("game_tag rows after tag delete = %d, want 0 (cascade)", joinCount)
	}
}

// TestAuditFilter_MultipleEntityTypes verifies the games admin tab's feed: the
// entity filter accepts several types at once, so game and tag events appear
// in one list while staying separable.
func TestAuditFilter_MultipleEntityTypes(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	actor := createTestAdmin(t, pool)
	tagSvc := elo.NewTagService(pool)
	gameSvc := elo.NewGameService(pool)
	auditSvc := elo.NewAuditService(pool)

	gameID := createTestGame(t, pool, "Аудит-игра")
	tag, err := tagSvc.CreateTag(ctx, newID(t), "аудит-тег", actor)
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}
	if err := tagSvc.AddGameTag(ctx, gameID, tag.ID); err != nil {
		t.Fatalf("AddGameTag: %v", err)
	}
	if _, err := tagSvc.UpdateTagName(ctx, tag.ID, "аудит-тег-2", actor); err != nil {
		t.Fatalf("UpdateTagName: %v", err)
	}
	// A game rename adds one entity_type=game event; the tag rename adds a
	// tag one; the attachment itself is not audited.
	if _, err := gameSvc.UpdateGameName(ctx, gameID, "Аудит-игра-2", actor); err != nil {
		t.Fatalf("UpdateGameName: %v", err)
	}

	rows, err := auditSvc.ListAuditEvents(ctx, db.ListAuditEventsParams{
		EntityTypes: []string{"game", "tag"},
		Limit:       100,
	})
	if err != nil {
		t.Fatalf("ListAuditEvents(game,tag): %v", err)
	}
	var games, tags int
	for _, r := range rows {
		switch r.EntityType {
		case "game":
			games++
		case "tag":
			tags++
		}
	}
	if games != 1 || tags != 2 {
		t.Fatalf("multi-type feed: %d game events, %d tag events, want 1 and 2", games, tags)
	}

	rows, err = auditSvc.ListAuditEvents(ctx, db.ListAuditEventsParams{
		EntityTypes: []string{"game"},
		Limit:       100,
	})
	if err != nil {
		t.Fatalf("ListAuditEvents(game): %v", err)
	}
	if len(rows) != 1 || rows[0].EntityType != "game" {
		t.Fatalf("single-type feed = %d rows, want exactly the 1 game event", len(rows))
	}

	// A nil type list means "no filter" and returns everything.
	rows, err = auditSvc.ListAuditEvents(ctx, db.ListAuditEventsParams{Limit: 100})
	if err != nil {
		t.Fatalf("ListAuditEvents(unfiltered): %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("unfiltered feed = %d rows, want 3", len(rows))
	}
}

// TestAddGameTag_UnknownReferences verifies that attaching a tag to a missing
// game (or a missing tag to a game) fails with a foreign-key violation — the
// handler layer maps it to 400.
func TestAddGameTag_UnknownReferences(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	tagSvc := elo.NewTagService(pool)

	tag, err := tagSvc.CreateTag(ctx, newID(t), "сирота", createTestAdmin(t, pool))
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}

	if err := tagSvc.AddGameTag(ctx, newID(t), tag.ID); !db.IsForeignKeyViolation(err) {
		t.Fatalf("AddGameTag to unknown game: want FK violation, got %v", err)
	}
	if err := tagSvc.AddGameTag(ctx, createTestGame(t, pool, "Игра без тега"), newID(t)); !db.IsForeignKeyViolation(err) {
		t.Fatalf("AddGameTag with unknown tag: want FK violation, got %v", err)
	}

	if _, err := tagSvc.DeleteTag(ctx, newID(t), newID(t)); !db.IsNoRows(err) {
		t.Fatalf("DeleteTag unknown: want no-rows, got %v", err)
	}
}
