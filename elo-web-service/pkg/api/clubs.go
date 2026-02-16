package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type clubJson struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	Players []int  `json:"players"`
}

func (a *API) ListClubs(c *gin.Context) {
	ctx := c.Request.Context()
	rows, err := a.Queries.ListClubs(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Group rows by club id and collect players
	clubsMap := map[int32]*clubJson{}
	for _, r := range rows {
		cj, ok := clubsMap[r.ClubID]
		if !ok {
			cj = &clubJson{
				Id:      strconv.FormatInt(int64(r.ClubID), 10),
				Name:    r.ClubName,
				Players: []int{},
			}
			clubsMap[r.ClubID] = cj
		}

		if r.PlayerID.Valid {
			cj.Players = append(cj.Players, int(r.PlayerID.Int32))
		}
	}

	// Convert map to slice
	resp := make([]clubJson, 0, len(clubsMap))
	for _, v := range clubsMap {
		resp = append(resp, *v)
	}

	SuccessDataResponse(c, resp)
}
