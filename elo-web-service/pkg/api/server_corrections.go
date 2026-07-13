package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type correctionCursor struct {
	PlayerID *string `json:"player_id,omitempty"`
	ClubID   *string `json:"club_id,omitempty"`
	NoClub   bool    `json:"no_club,omitempty"`
	Date     string  `json:"date"` // RFC3339Nano
}

func encodeCorrectionCursor(playerID *string, clubID *string, noClub bool, date time.Time) string {
	c := correctionCursor{Date: date.UTC().Format(time.RFC3339Nano), NoClub: noClub}
	c.PlayerID = playerID
	c.ClubID = clubID
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

// decodeCorrectionCursor returns playerID, clubID, noClub, cursorDate decoded from the token.
func decodeCorrectionCursor(token string) (*string, *string, bool, pgtype.Timestamptz, error) {
	b, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return nil, nil, false, pgtype.Timestamptz{}, err
	}
	var c correctionCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, nil, false, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return nil, nil, false, pgtype.Timestamptz{}, err
	}
	return c.PlayerID, c.ClubID, c.NoClub, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

func (s *StrictServer) ListCorrections(ctx context.Context, request ListCorrectionsRequestObject) (ListCorrectionsResponseObject, error) {
	params := request.Params
	var playerID *string
	var clubID *string
	var noClub bool
	var cursorDate pgtype.Timestamptz

	if params.Next != nil && *params.Next != "" {
		var err error
		playerID, clubID, noClub, cursorDate, err = decodeCorrectionCursor(*params.Next)
		if err != nil {
			return ListCorrections400JSONResponse{Status: "fail", Message: "Invalid cursor"}, nil
		}
	} else {
		if params.PlayerId != nil {
			pid := *params.PlayerId
			playerID = &pid
		}
		if params.ClubId != nil {
			if *params.ClubId == "__no_club__" {
				noClub = true
			} else {
				cl := *params.ClubId
				clubID = &cl
			}
		}
	}

	limit := int32(30)
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = int32(*params.Limit)
	}

	rows, err := s.api.Queries.ListCorrectionsPaginated(ctx, db.ListCorrectionsPaginatedParams{
		PlayerID:   playerID,
		ClubID:     clubID,
		NoClub:     pgtype.Bool{Bool: noClub, Valid: noClub},
		CursorDate: cursorDate,
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}

	data := make([]Correction, 0, len(rows))
	for _, r := range rows {
		data = append(data, Correction{
			Id:         r.ID,
			PlayerId:   r.PlayerID,
			PlayerName: r.PlayerName,
			Diff:       r.Diff,
			Date:       r.Date.Time,
		})
	}

	var next *string
	if int32(len(rows)) == limit {
		lastRow := rows[len(rows)-1]
		token := encodeCorrectionCursor(playerID, clubID, noClub, lastRow.Date.Time)
		next = &token
	}

	return ListCorrections200JSONResponse{
		Status: "success",
		Data:   data,
		Next:   next,
	}, nil
}
