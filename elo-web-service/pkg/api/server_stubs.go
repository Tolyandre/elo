package api

// server_stubs.go contains StrictServerInterface methods that cannot be fully
// migrated to typed request/response objects due to import-cycle constraints.
//
// Auth handlers delegate to AuthHandlers (an interface defined in server.go)
// to avoid the import cycle between pkg/api and pkg/api/oauth2.

import (
	"context"
)

// ---- Auth (delegates to AuthHandlers to avoid import cycle) ----

func (s *StrictServer) AuthLogin(ctx context.Context, _ AuthLoginRequestObject) (AuthLoginResponseObject, error) {
	s.auth.Login(ginCtxFromContext(ctx))
	return nil, nil
}

func (s *StrictServer) AuthLogout(ctx context.Context, _ AuthLogoutRequestObject) (AuthLogoutResponseObject, error) {
	s.auth.LogoutUser(ginCtxFromContext(ctx))
	return nil, nil
}

func (s *StrictServer) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	s.auth.GetMe(ginCtxFromContext(ctx))
	return nil, nil
}

func (s *StrictServer) PatchMe(ctx context.Context, _ PatchMeRequestObject) (PatchMeResponseObject, error) {
	s.auth.PatchMe(ginCtxFromContext(ctx))
	return nil, nil
}

func (s *StrictServer) AuthOAuth2Callback(ctx context.Context, _ AuthOAuth2CallbackRequestObject) (AuthOAuth2CallbackResponseObject, error) {
	s.auth.GoogleOAuth(ginCtxFromContext(ctx))
	return nil, nil
}
