package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func GetMe(ctx *gin.Context) {
	currentUser := ctx.MustGet("currentUser")

	ctx.JSON(http.StatusOK, gin.H{"status": "success", "data": currentUser})
}
