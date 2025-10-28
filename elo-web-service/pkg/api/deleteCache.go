package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func DeleteCache(c *gin.Context) {
	err := googlesheet.InvalidateCache()

	if err != nil {
		errorResponse(c, http.StatusInternalServerError, err)
		return
	}

	statusMessageResponse(c, http.StatusOK, "Cache invalidated successfully")
}
