package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *API) ListClubs(c *gin.Context) {
	ctx := c.Request.Context()
	clubs, err := a.Queries.ListClubs(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessDataResponse(c, clubs)
}
