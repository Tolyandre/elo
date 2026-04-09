package api

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) ListMatches(ctx context.Context, request ListMatchesRequestObject) (ListMatchesResponseObject, error) {
	params := request.Params
	var gameID pgtype.Int4
	var playerID pgtype.Int4
	var clubID pgtype.Int4
	var noClub bool
	var cursorDate pgtype.Timestamptz

	if params.Next != nil && *params.Next != "" {
		var err error
		gameID, playerID, clubID, noClub, cursorDate, err = decodeMatchCursor(*params.Next)
		if err != nil {
			return ListMatches400JSONResponse{Status: "fail", Message: "Invalid cursor"}, nil
		}
	} else {
		if params.GameId != nil {
			g, err := strconv.ParseInt(*params.GameId, 10, 32)
			if err != nil {
				return ListMatches400JSONResponse{Status: "fail", Message: "Invalid game_id"}, nil
			}
			gameID = pgtype.Int4{Int32: int32(g), Valid: true}
		}
		if params.PlayerId != nil {
			p, err := strconv.ParseInt(*params.PlayerId, 10, 32)
			if err != nil {
				return ListMatches400JSONResponse{Status: "fail", Message: "Invalid player_id"}, nil
			}
			playerID = pgtype.Int4{Int32: int32(p), Valid: true}
		}
		if params.ClubId != nil {
			if *params.ClubId == "__no_club__" {
				noClub = true
			} else {
				cl, err := strconv.ParseInt(*params.ClubId, 10, 32)
				if err != nil {
					return ListMatches400JSONResponse{Status: "fail", Message: "Invalid club_id"}, nil
				}
				clubID = pgtype.Int4{Int32: int32(cl), Valid: true}
			}
		}
	}

	limit := int32(30)
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = int32(*params.Limit)
	}

	rows, err := s.api.Queries.ListMatchesWithPlayersPaginated(ctx, db.ListMatchesWithPlayersPaginatedParams{
		GameID:     gameID,
		PlayerID:   playerID,
		ClubID:     clubID,
		NoClub:     pgtype.Bool{Bool: noClub, Valid: noClub},
		CursorDate: cursorDate,
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}

	matchesMap := make(map[int32]*tempMatch)
	order := make([]int32, 0)

	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:         int(r.MatchID),
				GameId:     strconv.Itoa(int(r.GameID)),
				GameName:   r.GameName,
				Date:       r.Date.Time,
				Players:    make(map[int32]matchPlayerJson),
				HasMarkets: r.HasMarkets,
			}
			order = append(order, r.MatchID)
		}
		matchesMap[r.MatchID].Players[r.PlayerID] = matchPlayerJson{
			Score:      r.Score,
			RatingPay:  r.RatingPay,
			RatingEarn: r.RatingEarn,
		}
	}

	matchesSlice := buildMatchesResponse(matchesMap, order)
	data := make([]Match, 0, len(matchesSlice))
	for _, m := range matchesSlice {
		score := make(map[string]MatchPlayer, len(m.Players))
		for pid, p := range m.Players {
			score[pid] = MatchPlayer{
				RatingPay:  p.RatingPay,
				RatingEarn: p.RatingEarn,
				Score:      p.Score,
			}
		}
		data = append(data, Match{
			Id:         m.Id,
			GameId:     m.GameId,
			GameName:   m.GameName,
			Date:       m.Date,
			Score:      score,
			HasMarkets: m.HasMarkets,
		})
	}

	var next *string
	if int32(len(order)) == limit {
		lastID := order[len(order)-1]
		token := encodeMatchCursor(gameID, playerID, clubID, noClub, matchesMap[lastID].Date)
		next = &token
	}

	return ListMatches200JSONResponse{
		Status: "success",
		Data:   data,
		Next:   next,
	}, nil
}

func (s *StrictServer) AddMatch(ctx context.Context, request AddMatchRequestObject) (AddMatchResponseObject, error) {
	gameID, playerScores, err := parseMatchScores(request.Body.GameId, request.Body.Score)
	if err != nil {
		return AddMatch400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	match, err := s.api.MatchService.AddMatch(ctx, gameID, playerScores, time.Now())
	if err != nil {
		return addMatchError(err), nil
	}

	resp := AddMatch200JSONResponse{Status: "success"}
	resp.Data.Id = int(match.ID)
	return resp, nil
}

func addMatchError(err error) AddMatchResponseObject {
	switch matchDomainError(err) {
	case 400:
		return AddMatch400JSONResponse{Status: "fail", Message: err.Error()}
	case 409:
		return AddMatch409JSONResponse{Status: "fail", Message: err.Error()}
	default:
		return AddMatch400JSONResponse{Status: "fail", Message: err.Error()}
	}
}

func matchDomainError(err error) int {
	switch {
	case errors.Is(err, elo.ErrTooFewPlayers), errors.Is(err, elo.ErrDateChangeTooLarge), db.IsForeignKeyViolation(err):
		return 400
	case errors.Is(err, elo.ErrHistoryChangeConflict), errors.Is(err, elo.ErrHistoryChangeConflictBettingLock):
		return 409
	case errors.Is(err, elo.ErrMatchNotFound):
		return 404
	default:
		return 500
	}
}

func (s *StrictServer) GetMatchById(ctx context.Context, request GetMatchByIdRequestObject) (GetMatchByIdResponseObject, error) {
	matchID, err := strconv.ParseInt(request.Id, 10, 32)
	if err != nil {
		return GetMatchById400JSONResponse{Status: "fail", Message: "Invalid match id: " + request.Id}, nil
	}

	rows, err := s.api.Queries.GetMatchWithPlayers(ctx, int32(matchID))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetMatchById404JSONResponse{Status: "fail", Message: "Match not found"}, nil
	}

	matchesMap := make(map[int32]*tempMatch)
	order := make([]int32, 0)
	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:       int(r.MatchID),
				GameId:   strconv.Itoa(int(r.GameID)),
				GameName: r.GameName,
				Date:     r.Date.Time,
				Players:  make(map[int32]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}
		matchesMap[r.MatchID].Players[r.PlayerID] = matchPlayerJson{
			Score:      r.Score,
			RatingPay:  r.RatingPay,
			RatingEarn: r.RatingEarn,
		}
	}

	result := buildMatchesResponse(matchesMap, order)
	m := result[0]
	score := make(map[string]MatchPlayer, len(m.Players))
	for pid, p := range m.Players {
		score[pid] = MatchPlayer{
			RatingPay:  p.RatingPay,
			RatingEarn: p.RatingEarn,
			Score:      p.Score,
		}
	}

	return GetMatchById200JSONResponse{
		Status: "success",
		Data: Match{
			Id:         m.Id,
			GameId:     m.GameId,
			GameName:   m.GameName,
			Date:       m.Date,
			Score:      score,
			HasMarkets: m.HasMarkets,
		},
	}, nil
}

func (s *StrictServer) UpdateMatch(ctx context.Context, request UpdateMatchRequestObject) (UpdateMatchResponseObject, error) {
	matchID, err := strconv.ParseInt(request.Id, 10, 32)
	if err != nil {
		return UpdateMatch400JSONResponse{Status: "fail", Message: "Invalid match id: " + request.Id}, nil
	}

	gameID, playerScores, err := parseMatchScores(request.Body.GameId, request.Body.Score)
	if err != nil {
		return UpdateMatch400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	_, err = s.api.MatchService.UpdateMatch(ctx, int32(matchID), gameID, playerScores, request.Body.Date)
	if err != nil {
		switch matchDomainError(err) {
		case 400:
			return UpdateMatch400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case 404:
			return UpdateMatch404JSONResponse{Status: "fail", Message: err.Error()}, nil
		case 409:
			return UpdateMatch409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	return UpdateMatch200JSONResponse{Status: "success", Message: "Match is updated"}, nil
}
