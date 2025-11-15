package api

import (
	"github.com/gin-gonic/gin"
	api "github.com/tolyandre/elo-web-service/pkg/api"
)

func GetMe(ctx *gin.Context) {
	currentUser := ctx.MustGet("currentUser")
	api.SuccessDataResponse(ctx, currentUser)
}
