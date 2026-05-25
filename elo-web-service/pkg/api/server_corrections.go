package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type correctionCursor struct {
	PlayerID *int32 `json:"player_id,omitempty"`
	ClubID   *int32 `json:"club_id,omitempty"`
	NoClub   bool   `json:"no_club,omitempty"`
	Date     string `json:"date"` // RFC3339Nano
}

func encodeCorrectionCursor(playerID pgtype.Int4, clubID pgtype.Int4, noClub bool, date time.Time) string {
	c := correctionCursor{Date: date.UTC().Format(time.RFC3339Nano), NoClub: noClub}
	if playerID.Valid {
		c.PlayerID = &playerID.Int32
	}
	if clubID.Valid {
		c.ClubID = &clubID.Int32
	}
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

func decodeCorrectionCursor(token string) (pgtype.Int4, pgtype.Int4, bool, pgtype.Timestamptz, error) {
	b, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	var c correctionCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	var playerID pgtype.Int4
	if c.PlayerID != nil {
		playerID = pgtype.Int4{Int32: *c.PlayerID, Valid: true}
	}
	var clubID pgtype.Int4
	if c.ClubID != nil {
		clubID = pgtype.Int4{Int32: *c.ClubID, Valid: true}
	}
	return playerID, clubID, c.NoClub, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

func (s *StrictServer) ListCorrections(ctx context.Context, request ListCorrectionsRequestObject) (ListCorrectionsResponseObject, error) {
	params := request.Params
	var playerID pgtype.Int4
	var clubID pgtype.Int4
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
			p, err := strconv.ParseInt(*params.PlayerId, 10, 32)
			if err != nil {
				return ListCorrections400JSONResponse{Status: "fail", Message: "Invalid player_id"}, nil
			}
			playerID = pgtype.Int4{Int32: int32(p), Valid: true}
		}
		if params.ClubId != nil {
			if *params.ClubId == "__no_club__" {
				noClub = true
			} else {
				cl, err := strconv.ParseInt(*params.ClubId, 10, 32)
				if err != nil {
					return ListCorrections400JSONResponse{Status: "fail", Message: "Invalid club_id"}, nil
				}
				clubID = pgtype.Int4{Int32: int32(cl), Valid: true}
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
			Id:         int(r.ID),
			PlayerId:   strconv.Itoa(int(r.PlayerID)),
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
