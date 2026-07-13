package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type clubJson struct {
	Id            string  `json:"id"`
	Name          string  `json:"name"`
	GeologistName *string `json:"geologist_name,omitempty"`
	Players       []string `json:"players"`
}

func (a *API) ListClubs(c *gin.Context) {
	ctx := c.Request.Context()
	rows, err := a.ClubService.ListClubs(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	clubsMap := map[string]*clubJson{}
	for _, r := range rows {
		cj, ok := clubsMap[r.ClubID]
		if !ok {
			cj = &clubJson{
				Id:      r.ClubID,
				Name:    r.ClubName,
				Players: []string{},
			}
			if r.ClubGeologistName.Valid {
				cj.GeologistName = &r.ClubGeologistName.String
			}
			clubsMap[r.ClubID] = cj
		}

		if r.PlayerID != nil {
			cj.Players = append(cj.Players, *r.PlayerID)
		}
	}

	resp := make([]clubJson, 0, len(clubsMap))
	for _, v := range clubsMap {
		resp = append(resp, *v)
	}

	SuccessDataResponse(c, resp)
}

func (a *API) GetClub(c *gin.Context) {
	id := c.Param("id")

	rows, err := a.ClubService.GetClub(c.Request.Context(), id)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if len(rows) == 0 {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("club not found"))
		return
	}

	cj := &clubJson{
		Id:      id,
		Name:    rows[0].ClubName,
		Players: []string{},
	}
	if rows[0].ClubGeologistName.Valid {
		cj.GeologistName = &rows[0].ClubGeologistName.String
	}
	for _, r := range rows {
		if r.PlayerID != nil {
			cj.Players = append(cj.Players, *r.PlayerID)
		}
	}

	SuccessDataResponse(c, cj)
}

func (a *API) CreateClub(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if body.Name == "" {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}

	club, err := a.ClubService.CreateClub(c.Request.Context(), "", body.Name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			ErrorResponse(c, http.StatusConflict, fmt.Errorf("club with this name already exists"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	cj := clubJson{
		Id:      club.ID,
		Name:    club.Name,
		Players: []string{},
	}
	if club.GeologistName.Valid {
		cj.GeologistName = &club.GeologistName.String
	}
	SuccessDataResponse(c, cj)
}

func (a *API) PatchClub(c *gin.Context) {
	id := c.Param("id")

	var body struct {
		Name string `json:"name"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if body.Name == "" {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}

	club, err := a.ClubService.UpdateClub(c.Request.Context(), id, body.Name)
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("club not found"))
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	pj := clubJson{
		Id:      club.ID,
		Name:    club.Name,
		Players: []string{},
	}
	if club.GeologistName.Valid {
		pj.GeologistName = &club.GeologistName.String
	}
	SuccessDataResponse(c, pj)
}

func (a *API) DeleteClub(c *gin.Context) {
	id := c.Param("id")

	_, err := a.ClubService.DeleteClub(c.Request.Context(), id)
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("club not found"))
		return
	}
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("cannot delete club with members"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Club deleted")
}

func (a *API) AddClubMember(c *gin.Context) {
	clubId := c.Param("id")

	var body struct {
		PlayerId string `json:"player_id"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if body.PlayerId == "" {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("player_id is required"))
		return
	}

	err := a.ClubService.AddMember(c.Request.Context(), clubId, body.PlayerId)
	if err != nil {
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("club or player not found"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Member added")
}

func (a *API) RemoveClubMember(c *gin.Context) {
	clubId := c.Param("id")
	playerId := c.Param("playerId")

	err := a.ClubService.RemoveMember(c.Request.Context(), clubId, playerId)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Member removed")
}
