package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Audit log of user actions (ADR-14). Every audited write inserts its
// audit_log row inside the same transaction as the write itself, so the log
// can never disagree with the data. Events for which no actor could be
// resolved (zero id — impossible behind editorAuth in practice) are skipped
// rather than failing the user's write.

// IAuditService is the read side of the audit log.
type IAuditService interface {
	ListAuditEvents(ctx context.Context, arg db.ListAuditEventsParams) ([]db.ListAuditEventsRow, error)
}

type AuditService struct {
	Queries *db.Queries
}

func NewAuditService(pool *pgxpool.Pool) IAuditService {
	return &AuditService{Queries: db.New(pool)}
}

func (s *AuditService) ListAuditEvents(ctx context.Context, arg db.ListAuditEventsParams) ([]db.ListAuditEventsRow, error) {
	return s.Queries.ListAuditEvents(ctx, arg)
}

// recordAuditEvent appends one row via q — the *db.Queries of the caller's
// transaction, so the event commits (or rolls back) with the audited write.
// A zero actor skips the insert. details may be nil (no details document).
func recordAuditEvent(ctx context.Context, q *db.Queries, actor id.ID, entityType, action string, entityID id.ID, detailsKind string, details any) error {
	if actor.IsZero() {
		return nil
	}
	params := db.InsertAuditEventParams{
		ID:          id.New(),
		ActorUserID: actor,
		EntityType:  entityType,
		EntityID:    entityID,
		Action:      action,
	}
	if details != nil {
		raw, err := json.Marshal(details)
		if err != nil {
			return fmt.Errorf("audit: marshal %s details: %w", detailsKind, err)
		}
		if err := audit.Validate(detailsKind, raw); err != nil {
			return fmt.Errorf("audit: %s details: %w", detailsKind, err)
		}
		schema, err := audit.Lookup(detailsKind)
		if err != nil {
			return err
		}
		params.DetailsKind = pgtype.Text{String: detailsKind, Valid: true}
		params.DetailsSchemaVersion = pgtype.Int4{Int32: int32(schema.CurrentVersion), Valid: true}
		params.Details = raw
	}
	return q.InsertAuditEvent(ctx, params)
}

// buildMatchUpdateDetails diffs a match edit: old row + old scores (read
// before the rewrite) against the new values. Player changes are ordered by
// player id so the stored document is deterministic.
func buildMatchUpdateDetails(
	oldMatch db.Match,
	oldScores []db.GetMatchScoresRow,
	newDate time.Time,
	newGameID id.ID,
	newScores map[id.ID]float64,
	calculatorChanged bool,
) audit.MatchUpdateDetails {
	d := audit.NewMatchUpdateDetails()

	if oldMatch.Date.Valid && !oldMatch.Date.Time.Equal(newDate) {
		d.Date = &audit.DateChange{Old: oldMatch.Date.Time, New: newDate}
	}
	if oldMatch.GameID != newGameID {
		d.Game = &audit.GameChange{OldGameID: string(oldMatch.GameID), NewGameID: string(newGameID)}
	}

	oldByPlayer := make(map[id.ID]float64, len(oldScores))
	for _, s := range oldScores {
		oldByPlayer[s.PlayerID] = s.Score
	}
	for playerID, oldScore := range oldByPlayer {
		newScore, kept := newScores[playerID]
		if !kept {
			o := oldScore
			d.PlayerChanges = append(d.PlayerChanges, audit.PlayerChange{
				PlayerID: string(playerID),
				Change:   audit.PlayerRemoved,
				OldScore: &o,
			})
		} else if oldScore != newScore {
			o, n := oldScore, newScore
			d.PlayerChanges = append(d.PlayerChanges, audit.PlayerChange{
				PlayerID: string(playerID),
				Change:   audit.PlayerScore,
				OldScore: &o,
				NewScore: &n,
			})
		}
	}
	for playerID, newScore := range newScores {
		if _, had := oldByPlayer[playerID]; !had {
			n := newScore
			d.PlayerChanges = append(d.PlayerChanges, audit.PlayerChange{
				PlayerID: string(playerID),
				Change:   audit.PlayerAdded,
				NewScore: &n,
			})
		}
	}
	slices.SortFunc(d.PlayerChanges, func(a, b audit.PlayerChange) int {
		return strings.Compare(a.PlayerID, b.PlayerID)
	})

	d.CalculatorChanged = calculatorChanged
	return d
}

// jsonEqual compares two JSON documents structurally (order-insensitive for
// object keys), so a calculator document reserialized by the client does not
// register as a change.
func jsonEqual(a, b json.RawMessage) bool {
	if len(a) == 0 || len(b) == 0 {
		return len(a) == 0 && len(b) == 0
	}
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		return false
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		return false
	}
	return jsonDeepEqual(av, bv)
}

func jsonDeepEqual(a, b any) bool {
	switch av := a.(type) {
	case map[string]any:
		bm, ok := b.(map[string]any)
		if !ok || len(av) != len(bm) {
			return false
		}
		for k, v := range av {
			bv, exists := bm[k]
			if !exists || !jsonDeepEqual(v, bv) {
				return false
			}
		}
		return true
	case []any:
		ba, ok := b.([]any)
		if !ok || len(av) != len(ba) {
			return false
		}
		for i := range av {
			if !jsonDeepEqual(av[i], ba[i]) {
				return false
			}
		}
		return true
	default:
		return a == b
	}
}

// textEqual compares two nullable text columns.
func textEqual(a, b pgtype.Text) bool {
	return a.Valid == b.Valid && a.String == b.String
}
