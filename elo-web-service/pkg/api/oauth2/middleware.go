package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	api "github.com/tolyandre/elo-web-service/pkg/api"
)

func DeserializeUser() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		var token string
		cookie, err := ctx.Cookie(TokenCookieName)

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

		sub, err := ValidateToken(token, cookieJwtSecret)
		if err != nil {
			ctx.Abort()
			api.ErrorResponse(ctx, http.StatusUnauthorized, err)
			return
		}

		ctx.Set("currentUser", sub)
		ctx.Next()
	}
}
