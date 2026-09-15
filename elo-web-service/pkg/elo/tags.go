package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type TagRef struct {
	Id   id.ID
	Name string
}

type TagWithUsage struct {
	Id        id.ID
	Name      string
	GameCount int
}

type ITagService interface {
	ListTags(ctx context.Context) ([]TagWithUsage, error)
	// CreateTag/UpdateTagName/DeleteTag record audit events for the actor
	// (ADR-14); a zero actor skips the audit row. Attaching/detaching a tag to
	// a game is not audited (same as club memberships).
	CreateTag(ctx context.Context, tagID id.ID, name string, actor id.ID) (db.Tag, error)
	UpdateTagName(ctx context.Context, tagID id.ID, name string, actor id.ID) (TagWithUsage, error)
	DeleteTag(ctx context.Context, tagID id.ID, actor id.ID) (db.Tag, error)
	AddGameTag(ctx context.Context, gameID, tagID id.ID) error
	RemoveGameTag(ctx context.Context, gameID, tagID id.ID) error
}

type TagService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
}

func NewTagService(pool *pgxpool.Pool, arenas *ArenaService) ITagService {
	return &TagService{
		Queries: db.New(pool),
		Pool:    pool,
		Arenas:  arenas,
	}
}

func (s *TagService) ListTags(ctx context.Context) ([]TagWithUsage, error) {
	rows, err := s.Queries.ListTags(ctx)
	if err != nil {
		return nil, err
	}
	tags := make([]TagWithUsage, 0, len(rows))
	for _, r := range rows {
		tags = append(tags, TagWithUsage{Id: r.ID, Name: r.Name, GameCount: int(r.GameCount)})
	}
	return tags, nil
}

func (s *TagService) CreateTag(ctx context.Context, tagID id.ID, name string, actor id.ID) (db.Tag, error) {
	var created db.Tag
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		// CreateTag conflicts on id (idempotent replay) or on name (a different
		// tag already owns it). Audit only genuinely new rows. A zero id cannot
		// exist yet — skip the probe and let CreateTag surface the error.
		isNew := true
		if !tagID.IsZero() {
			_, perr := q.GetTagByID(ctx, tagID)
			isNew = db.IsNoRows(perr)
			if perr != nil && !isNew {
				return perr
			}
		}
		var err error
		created, err = q.CreateTag(ctx, db.CreateTagParams{ID: tagID, Name: name})
		if err != nil {
			return err
		}
		if isNew {
			return recordAuditEvent(ctx, q, actor, audit.EntityTag, audit.ActionCreated, tagID, audit.KindEntity, audit.NewEntityDetails(name))
		}
		return nil
	})
	return created, err
}

func (s *TagService) UpdateTagName(ctx context.Context, tagID id.ID, name string, actor id.ID) (TagWithUsage, error) {
	var updated TagWithUsage
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetTagByID(ctx, tagID)
		if err != nil {
			return err
		}
		t, err := q.UpdateTagName(ctx, db.UpdateTagNameParams{ID: tagID, Name: name})
		if err != nil {
			return err
		}
		count, err := q.GetTagGameCount(ctx, tagID)
		if err != nil {
			return err
		}
		updated = TagWithUsage{Id: t.ID, Name: t.Name, GameCount: int(count)}
		if old.Name != name {
			return recordAuditEvent(ctx, q, actor, audit.EntityTag, audit.ActionRenamed, tagID, audit.KindRename, audit.NewRenameDetails(old.Name, name))
		}
		return nil
	})
	return updated, err
}

func (s *TagService) DeleteTag(ctx context.Context, tagID id.ID, actor id.ID) (db.Tag, error) {
	// DeleteTag returns the deleted row, so the audit event captures the name
	// without a pre-read. The join rows go with it via ON DELETE CASCADE.
	var deleted db.Tag
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		var derr error
		deleted, derr = q.DeleteTag(ctx, tagID)
		if derr != nil {
			return derr
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityTag, audit.ActionDeleted, tagID, audit.KindEntity, audit.NewEntityDetails(deleted.Name))
	})
	return deleted, err
}

// AddGameTag/RemoveGameTag change which matches a tag-conditioned arena sees
// (ADR-24): the arenas are marked for a full recalculation and the background
// worker drains them (debounced — tag toggling can come in bursts).
func (s *TagService) AddGameTag(ctx context.Context, gameID, tagID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := q.AddGameTag(ctx, db.AddGameTagParams{GameID: gameID, TagID: tagID}); err != nil {
			return err
		}
		return s.Arenas.MarkTagFilteredArenasStale(ctx, q)
	})
}

func (s *TagService) RemoveGameTag(ctx context.Context, gameID, tagID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := q.RemoveGameTag(ctx, db.RemoveGameTagParams{GameID: gameID, TagID: tagID}); err != nil {
			return err
		}
		return s.Arenas.MarkTagFilteredArenasStale(ctx, q)
	})
}
