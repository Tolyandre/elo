package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// auditCursor is the continuation token encoded as base64 JSON. It embeds the
// filters so the client doesn't need to repeat them, plus the (created_at, id)
// row of the last returned event — the tie-break that keeps ordering stable
// when several events share a timestamp (same millisecond in one tx).
type auditCursor struct {
	EntityTypes []string `json:"entity_types,omitempty"`
	// LegacyEntityType carries cursors issued before the filter became a list;
	// still decoded so an in-flight pagination survives a deploy.
	LegacyEntityType *string `json:"entity_type,omitempty"`
	EntityID         *string `json:"entity_id,omitempty"`
	CreatedAt        string  `json:"created_at"` // RFC3339Nano
	ID               string  `json:"id"`         // canonical UUID
}

func encodeAuditCursor(entityTypes []string, entityID *string, createdAt time.Time, id string) string {
	c := auditCursor{
		EntityTypes: entityTypes,
		EntityID:    entityID,
		CreatedAt:   createdAt.UTC().Format(time.RFC3339Nano),
		ID:          id,
	}
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

func decodeAuditCursor(token string) (entityTypes []string, entityID *string, createdAt time.Time, id string, err error) {
	b, derr := base64.StdEncoding.DecodeString(token)
	if derr != nil {
		return nil, nil, time.Time{}, "", derr
	}
	var c auditCursor
	if uerr := json.Unmarshal(b, &c); uerr != nil {
		return nil, nil, time.Time{}, "", uerr
	}
	t, terr := time.Parse(time.RFC3339Nano, c.CreatedAt)
	if terr != nil {
		return nil, nil, time.Time{}, "", terr
	}
	if len(c.EntityTypes) > 0 {
		entityTypes = c.EntityTypes
	} else if c.LegacyEntityType != nil {
		entityTypes = []string{*c.LegacyEntityType}
	}
	return entityTypes, c.EntityID, t, c.ID, nil
}

// ListAuditEvents serves the public audit feed (ADR-14): latest first,
// optionally narrowed to one entity type (admin tabs) or one entity
// (match history).
func (s *StrictServer) ListAuditEvents(ctx context.Context, request ListAuditEventsRequestObject) (ListAuditEventsResponseObject, error) {
	params := request.Params
	var entityTypes []string
	var entityID *string
	var cursorCreatedAt pgtype.Timestamptz
	var cursorID *string

	if params.Next != nil && *params.Next != "" {
		var createdAt time.Time
		var id string
		var err error
		entityTypes, entityID, createdAt, id, err = decodeAuditCursor(*params.Next)
		if err != nil {
			return ListAuditEvents400JSONResponse{Status: "fail", Message: "Invalid cursor"}, nil
		}
		cursorCreatedAt = pgtype.Timestamptz{Time: createdAt, Valid: true}
		cursorID = &id
	} else {
		if params.EntityType != nil {
			for _, t := range *params.EntityType {
				entityTypes = append(entityTypes, string(t))
			}
		}
		if params.EntityId != nil {
			eid := parseIDParam(*params.EntityId)
			if eid.IsZero() {
				return ListAuditEvents400JSONResponse{Status: "fail", Message: "invalid entity_id"}, nil
			}
			s := string(eid)
			entityID = &s
		}
	}

	limit := int32(30)
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = int32(*params.Limit)
	}

	// A nil slice means "no type filter" (NULL ::text[] in the query); an
	// empty array would filter everything out.
	rows, err := s.api.AuditService.ListAuditEvents(ctx, db.ListAuditEventsParams{
		EntityTypes:     entityTypes,
		EntityID:        idPtr(entityID),
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        idPtr(cursorID),
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}

	data := make([]AuditEntry, 0, len(rows))
	for _, r := range rows {
		entry := AuditEntry{
			Id:          r.ID,
			CreatedAt:   r.CreatedAt,
			ActorUserId: r.ActorUserID,
			ActorName:   r.ActorName,
			EntityType:  AuditEntryEntityType(r.EntityType),
			EntityId:    r.EntityID,
			Action:      AuditEntryAction(r.Action),
		}
		if len(r.Details) > 0 && r.DetailsKind.Valid {
			details, derr := auditDetailsFromStored(r.DetailsKind.String, r.Details)
			if derr != nil {
				return nil, derr
			}
			entry.Details = details
		}
		data = append(data, entry)
	}

	var next *string
	if int32(len(rows)) == limit {
		lastRow := rows[len(rows)-1]
		token := encodeAuditCursor(entityTypes, entityID, lastRow.CreatedAt, string(lastRow.ID))
		next = &token
	}

	return ListAuditEvents200JSONResponse{
		Status: "success",
		Data:   data,
		Next:   next,
	}, nil
}

// auditDetailsFromStored shortens the canonical ids of a stored details
// document (ADR-12 boundary conversion) and decodes it into the generated
// union type.
func auditDetailsFromStored(kind string, raw json.RawMessage) (*AuditEntry_Details, error) {
	shortened, err := audit.ShortenIDs(kind, raw)
	if err != nil {
		return nil, err
	}
	var details AuditEntry_Details
	switch kind {
	case audit.KindEntity:
		var v AuditEntityDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditEntityDetails(v); err != nil {
			return nil, err
		}
	case audit.KindRename:
		var v AuditRenameDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditRenameDetails(v); err != nil {
			return nil, err
		}
	case audit.KindMatchUpdate:
		var v AuditMatchUpdateDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditMatchUpdateDetails(v); err != nil {
			return nil, err
		}
	default:
		return nil, audit.ErrUnknownKind
	}
	return &details, nil
}
