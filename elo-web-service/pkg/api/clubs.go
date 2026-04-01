package api

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type clubJson struct {
	Id            string  `json:"id"`
	Name          string  `json:"name"`
	GeologistName *string `json:"geologist_name,omitempty"`
	Players       []int   `json:"players"`
}

func (a *API) ListClubs(c *gin.Context) {
	ctx := c.Request.Context()
	rows, err := a.Queries.ListClubs(ctx)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	clubsMap := map[int32]*clubJson{}
	for _, r := range rows {
		cj, ok := clubsMap[r.ClubID]
		if !ok {
			cj = &clubJson{
				Id:      strconv.FormatInt(int64(r.ClubID), 10),
				Name:    r.ClubName,
				Players: []int{},
			}
			if r.ClubGeologistName.Valid {
				cj.GeologistName = &r.ClubGeologistName.String
			}
			clubsMap[r.ClubID] = cj
		}

		if r.PlayerID.Valid {
			cj.Players = append(cj.Players, int(r.PlayerID.Int32))
		}
	}

	resp := make([]clubJson, 0, len(clubsMap))
	for _, v := range clubsMap {
		resp = append(resp, *v)
	}

	SuccessDataResponse(c, resp)
}

func (a *API) GetClub(c *gin.Context) {
	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid club id: %w", err))
		return
	}

	rows, err := a.Queries.GetClub(c.Request.Context(), int32(idInt))
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if len(rows) == 0 {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("club not found"))
		return
	}

	cj := &clubJson{
		Id:      strconv.Itoa(idInt),
		Name:    rows[0].ClubName,
		Players: []int{},
	}
	if rows[0].ClubGeologistName.Valid {
		cj.GeologistName = &rows[0].ClubGeologistName.String
	}
	for _, r := range rows {
		if r.PlayerID.Valid {
			cj.Players = append(cj.Players, int(r.PlayerID.Int32))
		}
	}

	SuccessDataResponse(c, cj)
}

func (a *API) CreateClub(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to create clubs"))
		return
	}

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

	club, err := a.Queries.CreateClub(c.Request.Context(), body.Name)
	if err != nil {
		if db.IsUniqueViolation(err) {
			ErrorResponse(c, http.StatusConflict, fmt.Errorf("club with this name already exists"))
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	cj := clubJson{
		Id:      strconv.Itoa(int(club.ID)),
		Name:    club.Name,
		Players: []int{},
	}
	if club.GeologistName.Valid {
		cj.GeologistName = &club.GeologistName.String
	}
	SuccessDataResponse(c, cj)
}

func (a *API) PatchClub(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit clubs"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid club id: %w", err))
		return
	}

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

	club, err := a.Queries.UpdateClubName(c.Request.Context(), db.UpdateClubNameParams{
		ID:   int32(idInt),
		Name: body.Name,
	})
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("club not found"))
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	pj := clubJson{
		Id:      strconv.Itoa(int(club.ID)),
		Name:    club.Name,
		Players: []int{},
	}
	if club.GeologistName.Valid {
		pj.GeologistName = &club.GeologistName.String
	}
	SuccessDataResponse(c, pj)
}

func (a *API) DeleteClub(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to delete clubs"))
		return
	}

	idStr := c.Param("id")
	idInt, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid club id: %w", err))
		return
	}

	_, err = a.Queries.DeleteClub(c.Request.Context(), int32(idInt))
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
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit clubs"))
		return
	}

	idStr := c.Param("id")
	clubId, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid club id: %w", err))
		return
	}

	var body struct {
		PlayerId int32 `json:"player_id"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if body.PlayerId == 0 {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("player_id is required"))
		return
	}

	err = a.Queries.AddClubMember(c.Request.Context(), db.AddClubMemberParams{
		ClubID:   int32(clubId),
		PlayerID: body.PlayerId,
	})
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
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit clubs"))
		return
	}

	idStr := c.Param("id")
	clubId, err := strconv.Atoi(idStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid club id: %w", err))
		return
	}

	playerIdStr := c.Param("playerId")
	playerId, err := strconv.Atoi(playerIdStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid player id: %w", err))
		return
	}

	err = a.Queries.RemoveClubMember(c.Request.Context(), db.RemoveClubMemberParams{
		ClubID:   int32(clubId),
		PlayerID: int32(playerId),
	})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Member removed")
}
