package api

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

// clubFromGetRows builds a Club (with members and icon) from the LEFT-JOIN rows returned
// by GetClub. rows must be non-empty.
func clubFromGetRows(rows []db.GetClubRow) Club {
	c := Club{
		Id:        rows[0].ClubID,
		Name:      rows[0].ClubName,
		PlayerIds: []id.ID{},
	}
	if rows[0].ClubGeologistName.Valid {
		gn := rows[0].ClubGeologistName.String
		c.GeologistName = &gn
	}
	c.Icon = textPtr(rows[0].ClubIcon)
	if rows[0].ClubTenantID != nil {
		tid := Base58ID(*rows[0].ClubTenantID)
		c.TenantId = &tid
	}
	for _, r := range rows {
		if r.PlayerID != nil {
			c.PlayerIds = append(c.PlayerIds, *r.PlayerID)
		}
	}
	return c
}

func (s *StrictServer) ListClubs(ctx context.Context, _ ListClubsRequestObject) (ListClubsResponseObject, error) {
	rows, err := s.api.ClubService.ListClubs(ctx)
	if err != nil {
		return nil, err
	}

	clubsMap := map[string]*Club{}
	order := []id.ID{}

	for _, r := range rows {
		if _, ok := clubsMap[string(r.ClubID)]; !ok {
			c := Club{
				Id:        r.ClubID,
				Name:      r.ClubName,
				PlayerIds: []id.ID{},
			}
			if r.ClubGeologistName.Valid {
				gn := r.ClubGeologistName.String
				c.GeologistName = &gn
			}
			c.Icon = textPtr(r.ClubIcon)
			if r.ClubTenantID != nil {
				tid := Base58ID(*r.ClubTenantID)
				c.TenantId = &tid
			}
			clubsMap[string(r.ClubID)] = &c
			order = append(order, r.ClubID)
		}
		if r.PlayerID != nil {
			clubsMap[string(r.ClubID)].PlayerIds = append(clubsMap[string(r.ClubID)].PlayerIds, *r.PlayerID)
		}
	}

	result := make([]Club, 0, len(order))
	for _, cid := range order {
		result = append(result, *clubsMap[string(cid)])
	}

	return ListClubs200JSONResponse{Status: StatusSuccess, Data: result}, nil
}

func (s *StrictServer) GetClub(ctx context.Context, request GetClubRequestObject) (GetClubResponseObject, error) {
	rows, err := s.api.ClubService.GetClub(ctx, parseIDParam(request.Id))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
	}

	return GetClub200JSONResponse{Status: StatusSuccess, Data: clubFromGetRows(rows)}, nil
}

// clubFromDB builds the wire Club from a db.Club row (create response — a
// fresh club has no members yet).
func clubFromDB(c db.Club) Club {
	wire := Club{
		Id:        c.ID,
		Name:      c.Name,
		PlayerIds: []id.ID{},
	}
	if c.GeologistName.Valid {
		gn := c.GeologistName.String
		wire.GeologistName = &gn
	}
	wire.Icon = textPtr(c.Icon)
	if c.TenantID != nil {
		tid := Base58ID(*c.TenantID)
		wire.TenantId = &tid
	}
	return wire
}

func (s *StrictServer) CreateClub(ctx context.Context, request CreateClubRequestObject) (CreateClubResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateClub400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	club, err := s.api.ClubService.CreateClub(ctx, request.Body.Id, name, currentActorID(ctx))
	if err != nil {
		if domainStatusCode(err) == http.StatusConflict {
			return CreateClub409JSONResponse{Status: StatusFail, Message: "club with this name already exists"}, nil
		}
		return nil, err
	}

	return CreateClub200JSONResponse{Status: StatusSuccess, Data: clubFromDB(club)}, nil
}

func (s *StrictServer) PatchClub(ctx context.Context, request PatchClubRequestObject) (PatchClubResponseObject, error) {
	if request.Body == nil {
		return PatchClub400JSONResponse{Status: StatusFail, Message: "request body is required"}, nil
	}

	updateName := request.Body.Name != nil
	updateIcon := request.Body.Icon != nil
	if !updateName && !updateIcon {
		return PatchClub400JSONResponse{Status: StatusFail, Message: "nothing to update"}, nil
	}

	if updateName && *request.Body.Name == "" {
		return PatchClub400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	clubID := parseIDParam(request.Id)

	// Validate the icon key before touching the database so a bad key never partially applies.
	// An empty string clears the icon; a non-empty value is a built-in icon key.
	var iconArg *string
	if updateIcon {
		iconValue := *request.Body.Icon
		if iconValue == "" {
			iconArg = nil
		} else {
			validated, err := validateClubIconKey(iconValue)
			if err != nil {
				return PatchClub400JSONResponse{Status: StatusFail, Message: "invalid icon: " + err.Error()}, nil
			}
			iconArg = &validated
		}
	}

	if updateName {
		if _, err := s.api.ClubService.UpdateClub(ctx, clubID, *request.Body.Name, currentActorID(ctx)); err != nil {
			if domainStatusCode(err) == http.StatusNotFound {
				return PatchClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
			}
			// PatchClub's OpenAPI response only defines 200/400/401/403/404 — there
			// is no 409, so a name uniqueness violation falls through to 500 via
			// errorMiddleware (same behavior as before the refactor).
			return nil, err
		}
	}

	if updateIcon {
		if _, err := s.api.ClubService.UpdateClubIcon(ctx, clubID, iconArg, currentActorID(ctx)); err != nil {
			if domainStatusCode(err) == http.StatusNotFound {
				return PatchClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
			}
			return nil, err
		}
	}

	rows, err := s.api.ClubService.GetClub(ctx, clubID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return PatchClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
	}

	return PatchClub200JSONResponse{Status: StatusSuccess, Data: clubFromGetRows(rows)}, nil
}

func (s *StrictServer) DeleteClub(ctx context.Context, request DeleteClubRequestObject) (DeleteClubResponseObject, error) {
	_, err := s.api.ClubService.DeleteClub(ctx, parseIDParam(request.Id), currentActorID(ctx))
	switch {
	case err == nil:
	case domainStatusCode(err) == http.StatusNotFound:
		return DeleteClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
	case domainStatusCode(err) == http.StatusBadRequest:
		return DeleteClub400JSONResponse{Status: StatusFail, Message: "cannot delete club"}, nil
	default:
		return nil, err
	}

	return DeleteClub200JSONResponse{Status: StatusSuccess, Message: "Club deleted"}, nil
}

func (s *StrictServer) AddClubMember(ctx context.Context, request AddClubMemberRequestObject) (AddClubMemberResponseObject, error) {
	playerID := request.Body.PlayerId
	if playerID == "" {
		return AddClubMember400JSONResponse{Status: StatusFail, Message: "player_id is required"}, nil
	}

	err := s.api.ClubService.AddMember(ctx, currentActorID(ctx), parseIDParam(request.Id), playerID)
	if err != nil {
		// A still-active stint for the same (club, player) is a silent no-op
		// (the query's ON CONFLICT), so only referential errors land here.
		if domainStatusCode(err) == http.StatusBadRequest {
			return AddClubMember400JSONResponse{Status: StatusFail, Message: "club or player not found"}, nil
		}
		return nil, err
	}

	return AddClubMember200JSONResponse{Status: StatusSuccess, Message: "Member added"}, nil
}

func (s *StrictServer) RemoveClubMember(ctx context.Context, request RemoveClubMemberRequestObject) (RemoveClubMemberResponseObject, error) {
	err := s.api.ClubService.RemoveMember(ctx, currentActorID(ctx), parseIDParam(request.Id), parseIDParam(request.PlayerId))
	if err != nil {
		return nil, err
	}

	return RemoveClubMember200JSONResponse{Status: StatusSuccess, Message: "Member removed"}, nil
}

// ListClubMemberHistory serves GET /clubs/{id}/members/history (ADR-36): the
// club's membership stint history, latest first — the raw material of tenant
// membership, shown as audit-style items on the admin club page.
func (s *StrictServer) ListClubMemberHistory(ctx context.Context, request ListClubMemberHistoryRequestObject) (ListClubMemberHistoryResponseObject, error) {
	rows, err := s.api.ClubService.ListMemberHistory(ctx, parseIDParam(request.Id))
	if err != nil {
		return nil, err
	}
	stints := make([]ClubMemberStint, 0, len(rows))
	for _, r := range rows {
		stint := ClubMemberStint{
			ClubId:     Base58ID(r.ClubID),
			PlayerId:   Base58ID(r.PlayerID),
			PlayerName: r.PlayerName,
		}
		// -infinity joined_at (stints predating the column, migration 068)
		// has no wire representation — report null ("predates tracking").
		if r.JoinedAt.Valid && r.JoinedAt.InfinityModifier == pgtype.Finite {
			t := r.JoinedAt.Time
			stint.JoinedAt = &t
		}
		if r.LeftAt.Valid && r.LeftAt.InfinityModifier == pgtype.Finite {
			t := r.LeftAt.Time
			stint.LeftAt = &t
		}
		stints = append(stints, stint)
	}
	return ListClubMemberHistory200JSONResponse{Status: StatusSuccess, Data: stints}, nil
}
