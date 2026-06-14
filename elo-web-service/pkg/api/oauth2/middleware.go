package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	api "github.com/tolyandre/elo-web-service/pkg/api"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

func (a *OAUTH2) DeserializeUser() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var token string
		cookie, err := ctx.Cookie(cfg.Config.CookieName)

		authorizationHeader := ctx.Request.Header.Get("Authorization")
		fields := strings.Fields(authorizationHeader)

		if len(fields) != 0 && fields[0] == "Bearer" {
			token = fields[1]
		} else if err == nil {
			token = cookie
		}

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
		var token string
		cookie, err := ctx.Cookie(cfg.Config.CookieName)

		authorizationHeader := ctx.Request.Header.Get("Authorization")
		fields := strings.Fields(authorizationHeader)

		if len(fields) != 0 && fields[0] == "Bearer" {
			token = fields[1]
		} else if err == nil {
			token = cookie
		}

		if token != "" {
			userID, expiry, err := ValidateToken(token, cfg.Config.CookieJwtSecret)
			if err == nil {
				renewCookieIfNeeded(ctx, userID, expiry)
				ctx.Set(api.CurrentUserKey, userID)
			}
		}

		ctx.Next()
	}
}

// renewCookieIfNeeded issues a fresh cookie when less than half the TTL remains,
// extending the session for active users without requiring re-authentication.
func renewCookieIfNeeded(ctx *gin.Context, userID string, expiry time.Time) {
	ttl := time.Duration(cfg.Config.CookieTtlSeconds) * time.Second
	if time.Until(expiry) >= ttl/2 {
		return
	}
	id, err := strconv.ParseInt(userID, 10, 32)
	if err != nil {
		return
	}
	newToken, err := CreateJwt(ttl, int32(id), cfg.Config.CookieJwtSecret)
	if err != nil {
		return
	}
	setTokenCookie(ctx, newToken, cfg.Config.CookieTtlSeconds)
}
