package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	api "github.com/tolyandre/elo-web-service/pkg/api"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

func (a *OAUTH2) DeserializeUser() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		token := extractToken(ctx)
		if token == "" {
			ctx.Abort()
			api.ErrorResponse(ctx, http.StatusUnauthorized, "You are not logged in")
			return
		}

		userID, expiry, err := ValidateToken(token, cfg.Config.CookieJwtSecret)
		if err != nil {
			ctx.Abort()
			api.ErrorResponse(ctx, http.StatusUnauthorized, err)
			return
		}

		renewCookieIfNeeded(ctx, userID, expiry)

		ctx.Set(api.CurrentUserKey, userID)
		ctx.Next()
	}
}

// OptionalDeserializeUser attempts to authenticate the user but does not abort on failure.
// If authenticated, sets CurrentUserKey in context. Otherwise continues without it.
func (a *OAUTH2) OptionalDeserializeUser() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if token := extractToken(ctx); token != "" {
			if userID, expiry, err := ValidateToken(token, cfg.Config.CookieJwtSecret); err == nil {
				renewCookieIfNeeded(ctx, userID, expiry)
				ctx.Set(api.CurrentUserKey, userID)
			}
		}

		ctx.Next()
	}
}

// extractToken pulls the bearer/cookie auth token from the request, preferring
// the Authorization: Bearer header and falling back to the auth cookie. Returns
// "" when no token is present.
func extractToken(ctx *gin.Context) string {
	if fields := strings.Fields(ctx.Request.Header.Get("Authorization")); len(fields) != 0 && fields[0] == "Bearer" {
		return fields[1]
	}
	if cookie, err := ctx.Cookie(cfg.Config.CookieName); err == nil {
		return cookie
	}
	return ""
}

// renewCookieIfNeeded issues a fresh cookie when less than half the TTL remains,
// extending the session for active users without requiring re-authentication.
func renewCookieIfNeeded(ctx *gin.Context, userID string, expiry time.Time) {
	ttl := time.Duration(cfg.Config.CookieTtlSeconds) * time.Second
	if time.Until(expiry) >= ttl/2 {
		return
	}
	newToken, err := CreateJwt(ttl, userID, cfg.Config.CookieJwtSecret)
	if err != nil {
		return
	}
	setTokenCookie(ctx, newToken, cfg.Config.CookieTtlSeconds)
}
