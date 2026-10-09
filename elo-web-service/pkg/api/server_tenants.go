package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Tenants (ADR-36): the community surface — lifecycle, openness settings,
// club composition and the community feed. Clubs stay pure grouping
// (server_clubs.go).

// tenantFromGetRows builds a Tenant (with clubs and main arena) from the
// LEFT-JOIN rows returned by GetTenant. rows must be non-empty.
func tenantFromGetRows(rows []db.GetTenantRow) TenantsTenant {
	t := TenantsTenant{
		Id:                  rows[0].TenantID,
		Name:                rows[0].TenantName,
		ClubIds:             []Base58ID{},
		ArenaMembershipMode: TenantsTenantArenaMembershipMode(rows[0].TenantArenaMembershipMode),
		TournamentsOpenness: TenantsTenantTournamentsOpenness(rows[0].TenantTournamentsOpenness),
	}
	if rows[0].TenantIcon.Valid {
		t.Icon = &rows[0].TenantIcon.String
	}
	if rows[0].MainArenaID != nil {
		t.MainArenaId = Base58ID(*rows[0].MainArenaID)
	}
	for _, r := range rows {
		if r.ClubID != nil {
			t.ClubIds = append(t.ClubIds, Base58ID(*r.ClubID))
		}
	}
	return t
}

// tenantFromListRows assembles one tenant from the ListTenants rows.
func tenantFromListRows(rows []db.ListTenantsRow) TenantsTenant {
	t := TenantsTenant{
		Id:                  rows[0].TenantID,
		Name:                rows[0].TenantName,
		ClubIds:             []Base58ID{},
		ArenaMembershipMode: TenantsTenantArenaMembershipMode(rows[0].TenantArenaMembershipMode),
		TournamentsOpenness: TenantsTenantTournamentsOpenness(rows[0].TenantTournamentsOpenness),
	}
	if rows[0].TenantIcon.Valid {
		t.Icon = &rows[0].TenantIcon.String
	}
	if rows[0].MainArenaID != nil {
		t.MainArenaId = Base58ID(*rows[0].MainArenaID)
	}
	for _, r := range rows {
		if r.ClubID != nil {
			t.ClubIds = append(t.ClubIds, Base58ID(*r.ClubID))
		}
	}
	return t
}

func (s *StrictServer) ListTenants(ctx context.Context, _ ListTenantsRequestObject) (ListTenantsResponseObject, error) {
	rows, err := s.api.TenantService.ListTenants(ctx)
	if err != nil {
		return nil, err
	}

	tenantsMap := map[string][]db.ListTenantsRow{}
	order := []id.ID{}
	for _, r := range rows {
		if _, ok := tenantsMap[string(r.TenantID)]; !ok {
			order = append(order, r.TenantID)
		}
		tenantsMap[string(r.TenantID)] = append(tenantsMap[string(r.TenantID)], r)
	}

	result := make([]TenantsTenant, 0, len(order))
	for _, tid := range order {
		result = append(result, tenantFromListRows(tenantsMap[string(tid)]))
	}

	return ListTenants200JSONResponse{Status: StatusSuccess, Data: result}, nil
}

func (s *StrictServer) CreateTenant(ctx context.Context, request CreateTenantRequestObject) (CreateTenantResponseObject, error) {
	body := request.Body
	name := body.Name
	if name == "" {
		return CreateTenant400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	var clubIDs []id.ID
	if body.ClubIds != nil {
		for _, c := range *body.ClubIds {
			clubIDs = append(clubIDs, id.ID(c))
		}
	}

	tenant, err := s.api.TenantService.CreateTenant(ctx, body.Id, name,
		string(body.ArenaMembershipMode), string(body.TournamentsOpenness), clubIDs, currentActorID(ctx))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return CreateTenant400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case http.StatusConflict:
			return CreateTenant409JSONResponse{Status: StatusFail, Message: "tenant with this name already exists, or a club already belongs to another tenant"}, nil
		default:
			return nil, err
		}
	}

	// Re-read through the join so the response carries the clubs and the
	// (freshly ensured) main_arena_id.
	rows, err := s.api.TenantService.GetTenant(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, err
	}
	return CreateTenant200JSONResponse{Status: StatusSuccess, Data: tenantFromGetRows(rows)}, nil
}

func (s *StrictServer) GetTenant(ctx context.Context, request GetTenantRequestObject) (GetTenantResponseObject, error) {
	rows, err := s.api.TenantService.GetTenant(ctx, parseIDParam(request.Id))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetTenant404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
	}
	return GetTenant200JSONResponse{Status: StatusSuccess, Data: tenantFromGetRows(rows)}, nil
}

func (s *StrictServer) PatchTenant(ctx context.Context, request PatchTenantRequestObject) (PatchTenantResponseObject, error) {
	if request.Body == nil {
		return PatchTenant400JSONResponse{Status: StatusFail, Message: "request body is required"}, nil
	}

	updateName := request.Body.Name != nil
	updateSettings := false
	if request.Body.ArenaMembershipMode != nil || request.Body.TournamentsOpenness != nil {
		// The openness pair is always provided together (mirrors the old
		// PatchClub tenant settings contract).
		if request.Body.ArenaMembershipMode == nil || request.Body.TournamentsOpenness == nil {
			return PatchTenant400JSONResponse{Status: StatusFail, Message: "arena_membership_mode and tournaments_openness must be provided together"}, nil
		}
		updateSettings = true
	}
	// The icon follows the club convention: an empty string clears it, a
	// non-empty value is a key into the frontend's built-in icon set.
	updateIcon := request.Body.Icon != nil
	if updateIcon && *request.Body.Icon != "" {
		if _, err := validateClubIconKey(*request.Body.Icon); err != nil {
			return PatchTenant400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
	}
	// The main arena's settings document (starting rating, leagues) is edited
	// through the tenant (ADR-36 phase 5) — arena PATCH on a main arena is a
	// 409 by design.
	var settingsArg []byte
	if request.Body.Settings != nil {
		raw, err := json.Marshal(request.Body.Settings)
		if err != nil {
			return PatchTenant400JSONResponse{Status: StatusFail, Message: "invalid settings document"}, nil
		}
		settingsArg = raw
	}
	if !updateName && !updateIcon && !updateSettings && request.Body.Settings == nil {
		return PatchTenant400JSONResponse{Status: StatusFail, Message: "nothing to update"}, nil
	}
	if updateName && *request.Body.Name == "" {
		return PatchTenant400JSONResponse{Status: StatusFail, Message: "name is required"}, nil
	}

	tenantID := parseIDParam(request.Id)

	// One service call = one transaction + one combined audit row; a mid-way
	// failure can no longer leave a half-applied PATCH.
	patch := elo.TenantPatch{}
	if updateName {
		patch.Name = request.Body.Name
	}
	if updateIcon {
		patch.Icon = request.Body.Icon
	}
	if request.Body.Settings != nil {
		patch.ArenaSettings = settingsArg
	}
	if updateSettings {
		mode := string(*request.Body.ArenaMembershipMode)
		openness := string(*request.Body.TournamentsOpenness)
		patch.ArenaMembershipMode = &mode
		patch.TournamentsOpenness = &openness
	}
	if _, err := s.api.TenantService.PatchTenant(ctx, tenantID, patch, currentActorID(ctx)); err != nil {
		if msg, ok := invalidSettings(err); ok {
			return PatchTenant400JSONResponse{Status: StatusFail, Message: msg}, nil
		}
		switch domainStatusCode(err) {
		case http.StatusNotFound:
			return PatchTenant404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
		case http.StatusConflict:
			return PatchTenant409JSONResponse{Status: StatusFail, Message: "tenant with this name already exists"}, nil
		case http.StatusBadRequest:
			return PatchTenant400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.api.TenantService.GetTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return PatchTenant404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
	}
	return PatchTenant200JSONResponse{Status: StatusSuccess, Data: tenantFromGetRows(rows)}, nil
}

func (s *StrictServer) SetTenantClubs(ctx context.Context, request SetTenantClubsRequestObject) (SetTenantClubsResponseObject, error) {
	tenantID := parseIDParam(request.Id)
	clubIDs := make([]id.ID, 0, len(request.Body.ClubIds))
	for _, c := range request.Body.ClubIds {
		clubIDs = append(clubIDs, id.ID(c))
	}

	if err := s.api.TenantService.UpdateTenantClubs(ctx, tenantID, clubIDs, currentActorID(ctx)); err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return SetTenantClubs400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case http.StatusNotFound:
			return SetTenantClubs404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
		case http.StatusConflict:
			return SetTenantClubs409JSONResponse{Status: StatusFail, Message: "a club already belongs to another tenant"}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.api.TenantService.GetTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return SetTenantClubs404JSONResponse{Status: StatusFail, Message: "tenant not found"}, nil
	}
	return SetTenantClubs200JSONResponse{Status: StatusSuccess, Data: tenantFromGetRows(rows)}, nil
}

// ListTenantFeed serves GET /tenants/{id}/feed (ADR-36): the community's
// activity, membership-scoped (ListTenantFeedEvents) with match settlement
// columns read from the tenant's main arena. A missing tenant is a 404.
func (s *StrictServer) ListTenantFeed(ctx context.Context, request ListTenantFeedRequestObject) (ListTenantFeedResponseObject, error) {
	tenantID := parseIDParam(request.Id)
	// A cursor from another tenant's feed is a bad request regardless of the tenant.
	if request.Params.Next != nil && *request.Params.Next != "" {
		if c, _, derr := decodeArenaFeedCursor(*request.Params.Next); derr == nil && c.TenantID != nil && *c.TenantID != string(tenantID) {
			return ListTenantFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
		}
	}
	arenaID, err := s.api.TenantService.FeedArena(ctx, tenantID)
	if err != nil {
		if db.IsNoRows(err) {
			return ListTenantFeed404JSONResponse{Status: StatusFail, Message: "Tenant not found"}, nil
		}
		return nil, err
	}
	req, err := parseTenantFeedRequest(arenaID, tenantID, request.Params.PlayerId, request.Params.ClubId, request.Params.GameId, request.Params.Next, request.Params.Limit)
	if err != nil {
		return ListTenantFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
	}
	page, err := s.serveFeedPage(ctx, req)
	if err != nil {
		return nil, err
	}
	return ListTenantFeed200JSONResponse(page), nil
}
