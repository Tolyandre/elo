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
		var actorName *string
		if r.ActorName.Valid {
			name := r.ActorName.String
			actorName = &name
		}
		var actorID Base58ID
		if r.ActorUserID != nil {
			actorID = *r.ActorUserID
		}
		entry := AuditEntry{
			Id:          r.ID,
			CreatedAt:   r.CreatedAt,
			ActorUserId: actorID,
			ActorName:   actorName,
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
	case audit.KindArenaCampConf:
		var v audit.ArenaCampConfigDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		g := AuditAuditArenaCampConfigDetails{SchemaVersion: v.SchemaVersion}
		if v.Name != nil {
			g.Name = &struct {
				From *string `json:"from,omitempty"`
				To   *string `json:"to,omitempty"`
			}{From: v.Name.From, To: v.Name.To}
		}
		if v.StartsAt != nil {
			g.StartsAt = &struct {
				From *time.Time `json:"from,omitempty"`
				To   *time.Time `json:"to,omitempty"`
			}{From: auditTime(v.StartsAt.From), To: auditTime(v.StartsAt.To)}
		}
		if v.EndsAt != nil {
			g.EndsAt = &struct {
				From *time.Time `json:"from,omitempty"`
				To   *time.Time `json:"to,omitempty"`
			}{From: auditTime(v.EndsAt.From), To: auditTime(v.EndsAt.To)}
		}
		if err := details.FromAuditAuditArenaCampConfigDetails(g); err != nil {
			return nil, err
		}
	case audit.KindCampLink:
		var v audit.CampLinkDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditAuditCampLinkDetails(AuditAuditCampLinkDetails{
			MatchId:       Base58ID(v.MatchID),
			Op:            AuditAuditCampLinkDetailsOp(v.Op),
			SchemaVersion: v.SchemaVersion,
		}); err != nil {
			return nil, err
		}
	case audit.KindTournamentConfig:
		var v audit.TournamentConfigDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		g := AuditAuditTournamentConfigDetails{SchemaVersion: v.SchemaVersion}
		if v.Name != nil {
			g.Name = &struct {
				From *string `json:"from,omitempty"`
				To   *string `json:"to,omitempty"`
			}{From: v.Name.From, To: v.Name.To}
		}
		if v.GrandFinalDeadline != nil {
			g.GrandFinalDeadline = &struct {
				From *time.Time `json:"from,omitempty"`
				To   *time.Time `json:"to,omitempty"`
			}{From: auditTime(v.GrandFinalDeadline.From), To: auditTime(v.GrandFinalDeadline.To)}
		}
		if v.Games != nil {
			from := tournamentGameDocs(v.Games.From)
			to := tournamentGameDocs(v.Games.To)
			g.Games = &struct {
				From *[]AuditAuditTournamentGameDoc `json:"from,omitempty"`
				To   *[]AuditAuditTournamentGameDoc `json:"to,omitempty"`
			}{From: from, To: to}
		}
		if v.FromPlayerIDs != nil && v.ToPlayerIDs != nil {
			from := base58IDs(v.FromPlayerIDs)
			to := base58IDs(v.ToPlayerIDs)
			g.FromPlayerIds = &from
			g.ToPlayerIds = &to
		}
		if err := details.FromAuditAuditTournamentConfigDetails(g); err != nil {
			return nil, err
		}
	case audit.KindTournamentStart:
		var v audit.TournamentStartDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		var plan TournamentPlan
		if err := json.Unmarshal(v.Plan, &plan); err != nil {
			return nil, err
		}
		if err := details.FromAuditAuditTournamentStartDetails(AuditAuditTournamentStartDetails{
			ParticipantIds: base58IDsPtr(v.ParticipantIDs),
			Plan:           plan,
			SchemaVersion:  v.SchemaVersion,
			Seed:           v.Seed,
		}); err != nil {
			return nil, err
		}
	case audit.KindTournamentState:
		var v audit.TournamentStateDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditAuditTournamentStateDetails(AuditAuditTournamentStateDetails{
			From:          AuditAuditTournamentStateDetailsFrom(v.From),
			Reason:        AuditAuditTournamentStateDetailsReason(v.Reason),
			SchemaVersion: v.SchemaVersion,
			To:            AuditAuditTournamentStateDetailsTo(v.To),
		}); err != nil {
			return nil, err
		}
	case audit.KindSlotRuling:
		var v audit.SlotRulingDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		if err := details.FromAuditAuditSlotRulingDetails(AuditAuditSlotRulingDetails{
			AfterPlayerIds:  base58IDsPtr(v.AfterPlayerIDs),
			BeforePlayerIds: base58IDsPtr(v.BeforePlayerIDs),
			Op:              AuditAuditSlotRulingDetailsOp(v.Op),
			SchemaVersion:   v.SchemaVersion,
			SlotId:          Base58ID(v.SlotID),
		}); err != nil {
			return nil, err
		}
	case audit.KindSlotLink:
		var v audit.SlotLinkDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		g := AuditAuditSlotLinkDetails{
			MatchId:       Base58ID(v.MatchID),
			Op:            AuditAuditSlotLinkDetailsOp(v.Op),
			OriginKind:    AuditAuditSlotLinkDetailsOriginKind(v.OriginKind),
			SchemaVersion: v.SchemaVersion,
			SlotId:        Base58ID(v.SlotID),
		}
		if v.OriginID != "" {
			origin := Base58ID(v.OriginID)
			g.OriginId = &origin
		}
		if err := details.FromAuditAuditSlotLinkDetails(g); err != nil {
			return nil, err
		}
	case audit.KindSlotAdjust:
		var v audit.SlotAdjustDetails
		if err := json.Unmarshal(shortened, &v); err != nil {
			return nil, err
		}
		g := AuditAuditSlotAdjustDetails{
			Op:            AuditAuditSlotAdjustDetailsOp(v.Op),
			SchemaVersion: v.SchemaVersion,
			SlotId:        Base58ID(v.SlotID),
		}
		if v.GameID != "" {
			game := Base58ID(v.GameID)
			g.GameId = &game
		}
		if v.SeatCount != 0 {
			sc := v.SeatCount
			g.SeatCount = &sc
		}
		if err := details.FromAuditAuditSlotAdjustDetails(g); err != nil {
			return nil, err
		}
	default:
		return nil, audit.ErrUnknownKind
	}
	return &details, nil
}

// auditTime parses the RFC3339 timestamps stored in details value changes;
// a malformed value becomes null instead of failing the whole feed.
func auditTime(s *string) *time.Time {
	if s == nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, *s)
	if err != nil {
		return nil
	}
	return &t
}

func base58IDs(ids []string) []Base58ID {
	out := make([]Base58ID, len(ids))
	for i, v := range ids {
		out[i] = Base58ID(v)
	}
	return out
}

func base58IDsPtr(ids []string) *[]Base58ID {
	if ids == nil {
		return nil
	}
	out := base58IDs(ids)
	return &out
}

func tournamentGameDocs(docs []audit.TournamentGameDoc) *[]AuditAuditTournamentGameDoc {
	if docs == nil {
		return nil
	}
	out := make([]AuditAuditTournamentGameDoc, len(docs))
	for i, d := range docs {
		out[i] = AuditAuditTournamentGameDoc{
			GameId:     Base58ID(d.GameID),
			MinPlayers: d.MinPlayers,
			MaxPlayers: d.MaxPlayers,
		}
	}
	return &out
}
