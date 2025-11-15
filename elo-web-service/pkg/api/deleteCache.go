package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func DeleteCache(c *gin.Context) {
	err := googlesheet.InvalidateCache()

	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Cache invalidated successfully")
}
