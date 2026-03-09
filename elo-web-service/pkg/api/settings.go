package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type settingsJson struct {
	EloConstK   float64 `json:"elo_const_k"`
	EloConstD   float64 `json:"elo_const_d"`
	StartingElo float64 `json:"starting_elo"`
	WinReward   float64 `json:"win_reward"`
}

type eloSettingEntryJson struct {
	EffectiveDate string  `json:"effective_date"`
	EloConstK     float64 `json:"elo_const_k"`
	EloConstD     float64 `json:"elo_const_d"`
	StartingElo   float64 `json:"starting_elo"`
	WinReward     float64 `json:"win_reward"`
}

type createSettingsJson struct {
	EffectiveDate time.Time `json:"effective_date" binding:"required"`
	EloConstK     float64   `json:"elo_const_k" binding:"required"`
	EloConstD     float64   `json:"elo_const_d" binding:"required"`
	StartingElo   float64   `json:"starting_elo" binding:"required"`
	WinReward     float64   `json:"win_reward" binding:"required"`
}

type deleteSettingsJson struct {
	EffectiveDate time.Time `json:"effective_date" binding:"required"`
}

func (a *API) ListSettings(c *gin.Context) {
	// Get settings effective at the current time
	settings, err := a.Queries.GetEloSettingsForDate(c.Request.Context(), pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessDataResponse(c, settingsJson{
		EloConstK:   settings.EloConstK,
		EloConstD:   settings.EloConstD,
		StartingElo: settings.StartingElo,
		WinReward:   settings.WinReward,
	})
}

func (a *API) ListAllSettings(c *gin.Context) {
	rows, err := a.Queries.ListEloSettings(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	entries := make([]eloSettingEntryJson, 0, len(rows))
	for _, r := range rows {
		var dateStr string
		if r.EffectiveDate.InfinityModifier == pgtype.NegativeInfinity {
			dateStr = "-infinity"
		} else {
			dateStr = r.EffectiveDate.Time.Format(time.RFC3339)
		}
		entries = append(entries, eloSettingEntryJson{
			EffectiveDate: dateStr,
			EloConstK:     r.EloConstK,
			EloConstD:     r.EloConstD,
			StartingElo:   r.StartingElo,
			WinReward:     r.WinReward,
		})
	}

	SuccessDataResponse(c, entries)
}

func (a *API) CreateSettings(c *gin.Context) {
	var payload createSettingsJson
	if err := c.ShouldBindJSON(&payload); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if !user.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, "You are not authorized to manage settings")
		return
	}

	if payload.WinReward < 0.1 || payload.WinReward > 5 {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("win_reward must be between 0.1 and 5"))
		return
	}

	if !payload.EffectiveDate.After(time.Now()) {
		ErrorResponse(c, http.StatusBadRequest, "effective_date must be in the future")
		return
	}

	err = a.Queries.CreateEloSettings(c.Request.Context(), db.CreateEloSettingsParams{
		EffectiveDate: pgtype.Timestamptz{Time: payload.EffectiveDate, Valid: true},
		EloConstK:     payload.EloConstK,
		EloConstD:     payload.EloConstD,
		StartingElo:   payload.StartingElo,
		WinReward:     payload.WinReward,
	})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusCreated, "Settings created")
}

func (a *API) DeleteSettings(c *gin.Context) {
	var payload deleteSettingsJson
	if err := c.ShouldBindJSON(&payload); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	user, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if !user.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, "You are not authorized to manage settings")
		return
	}

	if !payload.EffectiveDate.After(time.Now()) {
		ErrorResponse(c, http.StatusBadRequest, "can only delete future settings")
		return
	}

	err = a.Queries.DeleteEloSettings(c.Request.Context(), pgtype.Timestamptz{Time: payload.EffectiveDate, Valid: true})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Settings deleted")
}
