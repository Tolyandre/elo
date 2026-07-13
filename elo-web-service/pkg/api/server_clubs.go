package api

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
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
		Id:      rows[0].ClubID,
		Name:    rows[0].ClubName,
		Players: []string{},
	}
	if rows[0].ClubGeologistName.Valid {
		gn := rows[0].ClubGeologistName.String
		c.GeologistName = &gn
	}
	c.IconSvg = textPtr(rows[0].ClubIconSvg)
	for _, r := range rows {
		if r.PlayerID != nil {
			c.Players = append(c.Players, *r.PlayerID)
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
	order := []string{}

	for _, r := range rows {
		if _, ok := clubsMap[r.ClubID]; !ok {
			c := Club{
				Id:      r.ClubID,
				Name:    r.ClubName,
				Players: []string{},
			}
			if r.ClubGeologistName.Valid {
				gn := r.ClubGeologistName.String
				c.GeologistName = &gn
			}
			c.IconSvg = textPtr(r.ClubIconSvg)
			clubsMap[r.ClubID] = &c
			order = append(order, r.ClubID)
		}
		if r.PlayerID != nil {
			clubsMap[r.ClubID].Players = append(clubsMap[r.ClubID].Players, *r.PlayerID)
		}
	}

	result := make([]Club, 0, len(order))
	for _, id := range order {
		result = append(result, *clubsMap[id])
	}

	return ListClubs200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) GetClub(ctx context.Context, request GetClubRequestObject) (GetClubResponseObject, error) {
	rows, err := s.api.ClubService.GetClub(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
	}

	return GetClub200JSONResponse{Status: "success", Data: clubFromGetRows(rows)}, nil
}

func (s *StrictServer) CreateClub(ctx context.Context, request CreateClubRequestObject) (CreateClubResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateClub400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	club, err := s.api.ClubService.CreateClub(ctx, request.Body.Id, name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreateClub409JSONResponse{Status: "fail", Message: "club with this name already exists"}, nil
		}
		return nil, err
	}

	c := Club{
		Id:      club.ID,
		Name:    club.Name,
		Players: []string{},
	}
	if club.GeologistName.Valid {
		gn := club.GeologistName.String
		c.GeologistName = &gn
	}
	c.IconSvg = textPtr(club.IconSvg)

	return CreateClub200JSONResponse{Status: "success", Data: c}, nil
}

func (s *StrictServer) PatchClub(ctx context.Context, request PatchClubRequestObject) (PatchClubResponseObject, error) {
	if request.Body == nil {
		return PatchClub400JSONResponse{Status: "fail", Message: "request body is required"}, nil
	}

	updateName := request.Body.Name != nil
	updateIcon := request.Body.IconSvg != nil
	if !updateName && !updateIcon {
		return PatchClub400JSONResponse{Status: "fail", Message: "nothing to update"}, nil
	}

	if updateName && *request.Body.Name == "" {
		return PatchClub400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	// Validate the icon before touching the database so a bad icon never partially applies.
	var iconArg *string
	if updateIcon {
		if cleaned, ok := clubIconText(*request.Body.IconSvg); ok {
			sanitized, err := sanitizeClubIconSVG(cleaned)
			if err != nil {
				return PatchClub400JSONResponse{Status: "fail", Message: "invalid icon: " + err.Error()}, nil
			}
			iconArg = &sanitized
		}
		// otherwise iconArg stays nil → clear the icon
	}

	if updateName {
		if _, err := s.api.ClubService.UpdateClub(ctx, request.Id, *request.Body.Name); err != nil {
			if db.IsNoRows(err) {
				return PatchClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
			}
			return nil, err
		}
	}

	if updateIcon {
		if _, err := s.api.ClubService.UpdateClubIcon(ctx, request.Id, iconArg); err != nil {
			if db.IsNoRows(err) {
				return PatchClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
			}
			return nil, err
		}
	}

	rows, err := s.api.ClubService.GetClub(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return PatchClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
	}

	return PatchClub200JSONResponse{Status: "success", Data: clubFromGetRows(rows)}, nil
}

func (s *StrictServer) DeleteClub(ctx context.Context, request DeleteClubRequestObject) (DeleteClubResponseObject, error) {
	_, err := s.api.ClubService.DeleteClub(ctx, request.Id)
	if db.IsNoRows(err) {
		return DeleteClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			return DeleteClub400JSONResponse{Status: "fail", Message: "cannot delete club with members"}, nil
		}
		return nil, err
	}

	return DeleteClub200JSONResponse{Status: "success", Message: "Club deleted"}, nil
}

func (s *StrictServer) AddClubMember(ctx context.Context, request AddClubMemberRequestObject) (AddClubMemberResponseObject, error) {
	playerID := request.Body.PlayerId
	if playerID == "" {
		return AddClubMember400JSONResponse{Status: "fail", Message: "player_id is required"}, nil
	}

	err := s.api.ClubService.AddMember(ctx, request.Id, playerID)
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			return AddClubMember400JSONResponse{Status: "fail", Message: "club or player not found"}, nil
		}
		return nil, err
	}

	return AddClubMember200JSONResponse{Status: "success", Message: "Member added"}, nil
}

func (s *StrictServer) RemoveClubMember(ctx context.Context, request RemoveClubMemberRequestObject) (RemoveClubMemberResponseObject, error) {
	err := s.api.ClubService.RemoveMember(ctx, request.Id, request.PlayerId)
	if err != nil {
		return nil, err
	}

	return RemoveClubMember200JSONResponse{Status: "success", Message: "Member removed"}, nil
}
