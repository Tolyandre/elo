package api

import (
	"context"

	"github.com/gin-gonic/gin"
)

// AuthHandlers is a subset of the OAUTH2 handler methods needed by StrictServer.
// pkg/api/oauth2 imports pkg/api, so we can't import oauth2 here.
// We define this interface and the oauth2.OAUTH2 struct satisfies it implicitly.
type AuthHandlers interface {
	Login(ctx *gin.Context)
	GoogleOAuth(ctx *gin.Context)
	LogoutUser(ctx *gin.Context)
	GetMe(ctx *gin.Context)
	PatchMe(ctx *gin.Context)
}

// StrictServer implements StrictServerInterface by delegating to *API and AuthHandlers.
// It translates oapi-codegen typed request/response objects into the existing
// service calls, reusing all business logic without duplicating gin.Context handling.
//
// Auth endpoints (/auth/*) cannot import pkg/api/oauth2 directly due to a cycle
// (oauth2 already imports pkg/api). Instead, they delegate to AuthHandlers which
// the oauth2.OAUTH2 struct implements.
//
// Migration pattern for each resource:
//  1. Add a handler file (e.g. server_players.go) implementing the resource methods
//  2. Wire the resource routes through RegisterHandlers in main.go
//  3. Remove the old *gin.Context handler from the original file
type StrictServer struct {
	api  *API
	auth AuthHandlers
}

func NewStrictServer(api *API, auth AuthHandlers) *StrictServer {
	return &StrictServer{api: api, auth: auth}
}

// ginCtxFromContext extracts *gin.Context from a context.Context.
// oapi-codegen strict handler for Gin passes *gin.Context directly as context.Context
// since *gin.Context implements context.Context.
func ginCtxFromContext(ctx context.Context) *gin.Context {
	if ginCtx, ok := ctx.(*gin.Context); ok {
		return ginCtx
	}
	return nil
}
