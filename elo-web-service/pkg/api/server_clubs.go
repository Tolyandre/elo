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

// applyClubTenancy fills the ADR-36 tenancy fields of the wire Club from the
// db kind / openness columns and the main-arena id. The DB CHECKs guarantee
// the kind value; the openness enums are validated at write time.
func applyClubTenancy(c *Club, kind string, mode, openness pgtype.Text, mainArenaID *id.ID) {
	c.Kind = ClubKind(kind)
	if mode.Valid {
		m := ClubArenaMembershipMode(mode.String)
		c.ArenaMembershipMode = &m
	}
	if openness.Valid {
		o := ClubTournamentsOpenness(openness.String)
		c.TournamentsOpenness = &o
	}
	if mainArenaID != nil {
		aid := Base58ID(*mainArenaID)
		c.MainArenaId = &aid
	}
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
	applyClubTenancy(&c, rows[0].ClubKind, rows[0].ClubArenaMembershipMode,
		rows[0].ClubTournamentsOpenness, rows[0].MainArenaID)
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
			applyClubTenancy(&c, r.ClubKind, r.ClubArenaMembershipMode,
				r.ClubTournamentsOpenness, r.MainArenaID)
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

// clubFromDB builds the wire Club from a db.Club row (create / convert
// responses — a fresh club has no members yet).
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
	applyClubTenancy(&wire, c.Kind, c.ArenaMembershipMode, c.TournamentsOpenness, nil)
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

// tenantSettingsFromPatch extracts the optional openness settings pair; ok is
// false when neither field is present. Both must be provided together.
func tenantSettingsFromPatch(mode *PatchClubJSONBodyArenaMembershipMode, openness *PatchClubJSONBodyTournamentsOpenness) (string, string, bool, bool) {
	if mode == nil && openness == nil {
		return "", "", false, true
	}
	if mode == nil || openness == nil {
		return "", "", false, false
	}
	return string(*mode), string(*openness), true, true
}

func (s *StrictServer) PatchClub(ctx context.Context, request PatchClubRequestObject) (PatchClubResponseObject, error) {
	if request.Body == nil {
		return PatchClub400JSONResponse{Status: StatusFail, Message: "request body is required"}, nil
	}

	updateName := request.Body.Name != nil
	updateIcon := request.Body.Icon != nil
	modeArg, opennessArg, updateSettings, settingsOK := tenantSettingsFromPatch(request.Body.ArenaMembershipMode, request.Body.TournamentsOpenness)
	if !settingsOK {
		return PatchClub400JSONResponse{Status: StatusFail, Message: "arena_membership_mode and tournaments_openness must be provided together"}, nil
	}
	if !updateName && !updateIcon && !updateSettings {
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

	if updateSettings {
		if _, err := s.api.ClubService.UpdateTenantSettings(ctx, clubID, modeArg, opennessArg, currentActorID(ctx)); err != nil {
			switch domainStatusCode(err) {
			case http.StatusNotFound:
				return PatchClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
			case http.StatusConflict:
				return PatchClub409JSONResponse{Status: StatusFail, Message: "the club is not a tenant club"}, nil
			case http.StatusBadRequest:
				return PatchClub400JSONResponse{Status: StatusFail, Message: "invalid tenant settings"}, nil
			default:
				return nil, err
			}
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
		if _, err := s.api.ClubService.UpdateClubIcon(ctx, clubID, iconArg); err != nil {
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

func (s *StrictServer) ConvertClub(ctx context.Context, request ConvertClubRequestObject) (ConvertClubResponseObject, error) {
	clubID := parseIDParam(request.Id)
	if _, err := s.api.ClubService.ConvertToTenant(ctx, clubID,
		string(request.Body.ArenaMembershipMode), string(request.Body.TournamentsOpenness), currentActorID(ctx)); err != nil {
		switch domainStatusCode(err) {
		case http.StatusNotFound:
			return ConvertClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
		case http.StatusConflict:
			return ConvertClub409JSONResponse{Status: StatusFail, Message: "the club is already a tenant club"}, nil
		case http.StatusBadRequest:
			return ConvertClub400JSONResponse{Status: StatusFail, Message: "invalid tenant settings"}, nil
		default:
			return nil, err
		}
	}

	// Re-read through the join so the response carries the (freshly created)
	// main_arena_id.
	rows, err := s.api.ClubService.GetClub(ctx, clubID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return ConvertClub404JSONResponse{Status: StatusFail, Message: "club not found"}, nil
	}
	return ConvertClub200JSONResponse{Status: StatusSuccess, Data: clubFromGetRows(rows)}, nil
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

	err := s.api.ClubService.AddMember(ctx, parseIDParam(request.Id), playerID)
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
	err := s.api.ClubService.RemoveMember(ctx, parseIDParam(request.Id), parseIDParam(request.PlayerId))
	if err != nil {
		return nil, err
	}

	return RemoveClubMember200JSONResponse{Status: StatusSuccess, Message: "Member removed"}, nil
}

// ListClubFeed serves GET /clubs/{id}/feed (ADR-36): the community's activity,
// membership-scoped (ListClubFeedEvents) with match settlement columns read
// from the club's main arena. The feed is a tenant surface: a missing club or
// a group (no main arena) is a 404.
func (s *StrictServer) ListClubFeed(ctx context.Context, request ListClubFeedRequestObject) (ListClubFeedResponseObject, error) {
	clubID := parseIDParam(request.Id)
	// A cursor from another club's feed is a bad request regardless of the club.
	if request.Params.Next != nil && *request.Params.Next != "" {
		if c, _, derr := decodeArenaFeedCursor(*request.Params.Next); derr == nil && c.ClubID != nil && *c.ClubID != string(clubID) {
			return ListClubFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
		}
	}
	arenaID, err := s.api.ClubService.FeedArena(ctx, clubID)
	if err != nil {
		if db.IsNoRows(err) {
			return ListClubFeed404JSONResponse{Status: StatusFail, Message: "Club not found"}, nil
		}
		return nil, err
	}
	req, err := parseClubFeedRequest(arenaID, clubID, request.Params.PlayerId, request.Params.GameId, request.Params.Next, request.Params.Limit)
	if err != nil {
		return ListClubFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
	}
	page, err := s.serveFeedPage(ctx, req)
	if err != nil {
		return nil, err
	}
	return ListClubFeed200JSONResponse(page), nil
}
