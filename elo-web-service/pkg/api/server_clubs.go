package api

import (
	"context"
	"strconv"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

func clubFromRows(id int, name string, geologistName *string, playerIDs []int) Club {
	return Club{
		Id:            strconv.Itoa(id),
		Name:          name,
		GeologistName: geologistName,
		Players:       playerIDs,
	}
}

func (s *StrictServer) ListClubs(ctx context.Context, _ ListClubsRequestObject) (ListClubsResponseObject, error) {
	rows, err := s.api.ClubService.ListClubs(ctx)
	if err != nil {
		return nil, err
	}

	type entry struct {
		club    Club
		players []int
	}
	clubsMap := map[int32]*Club{}
	order := []int32{}

	for _, r := range rows {
		if _, ok := clubsMap[r.ClubID]; !ok {
			c := Club{
				Id:      strconv.FormatInt(int64(r.ClubID), 10),
				Name:    r.ClubName,
				Players: []int{},
			}
			if r.ClubGeologistName.Valid {
				gn := r.ClubGeologistName.String
				c.GeologistName = &gn
			}
			clubsMap[r.ClubID] = &c
			order = append(order, r.ClubID)
		}
		if r.PlayerID.Valid {
			clubsMap[r.ClubID].Players = append(clubsMap[r.ClubID].Players, int(r.PlayerID.Int32))
		}
	}

	result := make([]Club, 0, len(order))
	for _, id := range order {
		result = append(result, *clubsMap[id])
	}

	return ListClubs200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) GetClub(ctx context.Context, request GetClubRequestObject) (GetClubResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return GetClub400JSONResponse{Status: "fail", Message: "invalid club id"}, nil
	}

	rows, err := s.api.ClubService.GetClub(ctx, int32(idInt))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
	}

	c := Club{
		Id:      strconv.Itoa(idInt),
		Name:    rows[0].ClubName,
		Players: []int{},
	}
	if rows[0].ClubGeologistName.Valid {
		gn := rows[0].ClubGeologistName.String
		c.GeologistName = &gn
	}
	for _, r := range rows {
		if r.PlayerID.Valid {
			c.Players = append(c.Players, int(r.PlayerID.Int32))
		}
	}

	return GetClub200JSONResponse{Status: "success", Data: c}, nil
}

func (s *StrictServer) CreateClub(ctx context.Context, request CreateClubRequestObject) (CreateClubResponseObject, error) {
	name := request.Body.Name
	if name == "" {
		return CreateClub400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	club, err := s.api.ClubService.CreateClub(ctx, name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreateClub409JSONResponse{Status: "fail", Message: "club with this name already exists"}, nil
		}
		return nil, err
	}

	c := Club{
		Id:      strconv.Itoa(int(club.ID)),
		Name:    club.Name,
		Players: []int{},
	}
	if club.GeologistName.Valid {
		gn := club.GeologistName.String
		c.GeologistName = &gn
	}

	return CreateClub200JSONResponse{Status: "success", Data: c}, nil
}

func (s *StrictServer) PatchClub(ctx context.Context, request PatchClubRequestObject) (PatchClubResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return PatchClub400JSONResponse{Status: "fail", Message: "invalid club id"}, nil
	}

	name := request.Body.Name
	if name == "" {
		return PatchClub400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}

	club, err := s.api.ClubService.UpdateClub(ctx, int32(idInt), name)
	if db.IsNoRows(err) {
		return PatchClub404JSONResponse{Status: "fail", Message: "club not found"}, nil
	}
	if err != nil {
		return nil, err
	}

	c := Club{
		Id:      strconv.Itoa(int(club.ID)),
		Name:    club.Name,
		Players: []int{},
	}
	if club.GeologistName.Valid {
		gn := club.GeologistName.String
		c.GeologistName = &gn
	}

	return PatchClub200JSONResponse{Status: "success", Data: c}, nil
}

func (s *StrictServer) DeleteClub(ctx context.Context, request DeleteClubRequestObject) (DeleteClubResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return DeleteClub400JSONResponse{Status: "fail", Message: "invalid club id"}, nil
	}

	_, err = s.api.ClubService.DeleteClub(ctx, int32(idInt))
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
	clubID, err := strconv.Atoi(request.Id)
	if err != nil {
		return AddClubMember400JSONResponse{Status: "fail", Message: "invalid club id"}, nil
	}

	playerID := request.Body.PlayerId
	if playerID == 0 {
		return AddClubMember400JSONResponse{Status: "fail", Message: "player_id is required"}, nil
	}

	err = s.api.ClubService.AddMember(ctx, int32(clubID), int32(playerID))
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			return AddClubMember400JSONResponse{Status: "fail", Message: "club or player not found"}, nil
		}
		return nil, err
	}

	return AddClubMember200JSONResponse{Status: "success", Message: "Member added"}, nil
}

func (s *StrictServer) RemoveClubMember(ctx context.Context, request RemoveClubMemberRequestObject) (RemoveClubMemberResponseObject, error) {
	clubID, err := strconv.Atoi(request.Id)
	if err != nil {
		return RemoveClubMember400JSONResponse{Status: "fail", Message: "invalid club id"}, nil
	}

	playerID, err := strconv.Atoi(request.PlayerId)
	if err != nil {
		return RemoveClubMember400JSONResponse{Status: "fail", Message: "invalid player id"}, nil
	}

	err = s.api.ClubService.RemoveMember(ctx, int32(clubID), int32(playerID))
	if err != nil {
		return nil, err
	}

	return RemoveClubMember200JSONResponse{Status: "success", Message: "Member removed"}, nil
}
