package api

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

func (a *API) DeleteCache(c *gin.Context) {
	err := googlesheet.InvalidateCache()

	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	err = a.sync(c)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Cache invalidated successfully")
}

func (a *API) sync(ctx context.Context) error {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		return err
	}

	var games []string
	for _, match := range parsedData.Matches[1:] {
		games = append(games, match.Game)
	}

	_, err = a.Queries.AddGamesIfNotExists(ctx, games)
	if err != nil {
		return err
	}

	_, err = a.Queries.AddPlayersIfNotExists(ctx, parsedData.PlayerIds)
	if err != nil {
		return err
	}

	_, err = a.MatchService.ReplaceMatches(ctx, parsedData.Matches)
	if err != nil {
		return err
	}

	return nil
}
