package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (api *API) GetPing(c *gin.Context) {
	SuccessMessageResponse(c, http.StatusOK, "pong")
}
