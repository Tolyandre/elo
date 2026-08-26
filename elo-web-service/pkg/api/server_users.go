package api

import (
	"context"
	"net/http"
)

func (s *StrictServer) ListUsers(ctx context.Context, _ ListUsersRequestObject) (ListUsersResponseObject, error) {
	users, err := s.api.UserService.ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]User, 0, len(users))
	for _, u := range users {
		user := User{
			Id:      u.ID,
			Name:    u.GoogleOauthUserName,
			CanEdit: u.AllowEditing,
		}
		if u.PlayerID != nil {
			user.PlayerId = u.PlayerID
		}
		out = append(out, user)
	}

	return ListUsers200JSONResponse{Status: "success", Data: out}, nil
}

func (s *StrictServer) PatchUser(ctx context.Context, request PatchUserRequestObject) (PatchUserResponseObject, error) {
	if err := s.api.UserService.AllowEditing(ctx, parseIDParam(request.UserId), request.Body.CanEdit); err != nil {
		return nil, err
	}

	user, err := s.api.UserService.GetUserByID(ctx, parseIDParam(request.UserId))
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return PatchUser404JSONResponse{Status: "fail", Message: "user not found"}, nil
		}
		return nil, err
	}

	resp := User{
		Id:      user.ID,
		Name:    user.GoogleOauthUserName,
		CanEdit: user.AllowEditing,
	}
	if user.PlayerID != nil {
		resp.PlayerId = user.PlayerID
	}

	return PatchUser200JSONResponse{Status: "success", Data: resp}, nil
}
