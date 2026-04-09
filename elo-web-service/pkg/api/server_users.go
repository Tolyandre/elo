package api

import (
	"context"
	"fmt"
	"strconv"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (s *StrictServer) ListUsers(ctx context.Context, _ ListUsersRequestObject) (ListUsersResponseObject, error) {
	users, err := s.api.UserService.ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]User, 0, len(users))
	for _, u := range users {
		user := User{
			Id:      strconv.Itoa(int(u.ID)),
			Name:    u.GoogleOauthUserName,
			CanEdit: u.AllowEditing,
		}
		if u.PlayerID.Valid {
			s := fmt.Sprintf("%d", u.PlayerID.Int32)
			user.PlayerId = &s
		}
		out = append(out, user)
	}

	return ListUsers200JSONResponse{Status: "success", Data: out}, nil
}

func (s *StrictServer) PatchUser(ctx context.Context, request PatchUserRequestObject) (PatchUserResponseObject, error) {
	userIDInt, err := strconv.Atoi(request.UserId)
	if err != nil {
		return PatchUser400JSONResponse{Status: "fail", Message: "invalid user id"}, nil
	}

	if err := s.api.UserService.AllowEditing(ctx, int32(userIDInt), request.Body.CanEdit); err != nil {
		return nil, err
	}

	user, err := s.api.UserService.GetUserByID(ctx, int32(userIDInt))
	if db.IsNoRows(err) {
		return PatchUser404JSONResponse{Status: "fail", Message: "user not found"}, nil
	}
	if err != nil {
		return nil, err
	}

	resp := User{
		Id:      strconv.Itoa(int(user.ID)),
		Name:    user.GoogleOauthUserName,
		CanEdit: user.AllowEditing,
	}
	if user.PlayerID.Valid {
		pid := fmt.Sprintf("%d", user.PlayerID.Int32)
		resp.PlayerId = &pid
	}

	return PatchUser200JSONResponse{Status: "success", Data: resp}, nil
}
