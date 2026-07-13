package api

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) ListMatches(ctx context.Context, request ListMatchesRequestObject) (ListMatchesResponseObject, error) {
	params := request.Params
	var gameID *string
	var playerID *string
	var clubID *string
	var noClub bool
	var cursorDate pgtype.Timestamptz

	if params.Next != nil && *params.Next != "" {
		var err error
		gameID, playerID, clubID, noClub, cursorDate, err = decodeMatchCursor(*params.Next)
		if err != nil {
			return ListMatches400JSONResponse{Status: "fail", Message: "Invalid cursor"}, nil
		}
	} else {
		gameID = params.GameId
		playerID = params.PlayerId
		if params.ClubId != nil {
			if *params.ClubId == "__no_club__" {
				noClub = true
			} else {
				clubID = params.ClubId
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

	matchesMap := make(map[string]*tempMatch)
	order := make([]string, 0)

	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:         r.MatchID,
				GameId:     r.GameID,
				GameName:   r.GameName,
				Date:       r.Date.Time,
				Players:    make(map[string]matchPlayerJson),
				HasMarkets: r.HasMarkets,
			}
			order = append(order, r.MatchID)
		}
		var ratingAfter float64
		if v, ok := r.RatingAfter.(float64); ok {
			ratingAfter = v
		}
		matchesMap[r.MatchID].Players[r.PlayerID] = matchPlayerJson{
			Score:        r.Score,
			RatingStaked: r.RatingStaked.Float64,
			RatingEarned: r.RatingEarned.Float64,
			RatingAfter:  ratingAfter,
		}
	}

	tournamentsByMatch, err := s.tournamentsByMatch(ctx, order)
	if err != nil {
		return nil, err
	}

	matchesSlice := buildMatchesResponse(matchesMap, order)
	data := make([]Match, 0, len(matchesSlice))
	for _, m := range matchesSlice {
		score := make(map[string]MatchPlayer, len(m.Players))
		for pid, p := range m.Players {
			score[pid] = MatchPlayer{
				RatingStaked: p.RatingStaked,
				RatingEarned: p.RatingEarned,
				Score:        p.Score,
				RatingAfter:  p.RatingAfter,
			}
		}
		match := Match{
			Id:         m.Id,
			GameId:     m.GameId,
			GameName:   m.GameName,
			Date:       m.Date,
			Score:      score,
			HasMarkets: m.HasMarkets,
		}
		if ts := tournamentsByMatch[m.Id]; len(ts) > 0 {
			match.Tournaments = &ts
		}
		data = append(data, match)
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

	date := time.Now()
	opts := elo.AddMatchOpts{
		ID:            request.Body.Id,
		TournamentIDs: derefStringSlice(request.Body.TournamentIds),
	}
	if request.Body.Date != nil {
		date = *request.Body.Date
		opts.ClientDate = true
	}

	match, err := s.api.MatchService.AddMatch(ctx, gameID, playerScores, date, opts)
	if err != nil {
		return addMatchError(err), nil
	}

	resp := AddMatch200JSONResponse{Status: "success"}
	resp.Data.Id = match.ID
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

// derefStringSlice returns the pointed-to slice, or nil if the pointer is nil.
func derefStringSlice(s *[]string) []string {
	if s == nil {
		return nil
	}
	return *s
}

// tournamentsByMatch returns, per match id, the tournaments it belongs to.
func (s *StrictServer) tournamentsByMatch(ctx context.Context, matchIDs []string) (map[string][]MatchTournament, error) {
	if len(matchIDs) == 0 {
		return map[string][]MatchTournament{}, nil
	}
	rows, err := s.api.Queries.ListTournamentsByMatchIDs(ctx, matchIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[string][]MatchTournament)
	for _, r := range rows {
		out[r.MatchID] = append(out[r.MatchID], MatchTournament{
			Id:   r.TournamentID,
			Name: r.TournamentName,
		})
	}
	return out, nil
}

func matchDomainError(err error) int {
	switch {
	case errors.Is(err, elo.ErrTooFewPlayers), errors.Is(err, elo.ErrDateChangeTooLarge), errors.Is(err, elo.ErrMatchDateOutOfRange), db.IsForeignKeyViolation(err):
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
	rows, err := s.api.Queries.GetMatchWithPlayers(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetMatchById404JSONResponse{Status: "fail", Message: "Match not found"}, nil
	}

	matchesMap := make(map[string]*tempMatch)
	order := make([]string, 0)
	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:       r.MatchID,
				GameId:   r.GameID,
				GameName: r.GameName,
				Date:     r.Date.Time,
				Players:  make(map[string]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}
		var ratingAfter float64
		if v, ok := r.RatingAfter.(float64); ok {
			ratingAfter = v
		}
		matchesMap[r.MatchID].Players[r.PlayerID] = matchPlayerJson{
			Score:        r.Score,
			RatingStaked: r.RatingStaked.Float64,
			RatingEarned: r.RatingEarned.Float64,
			RatingAfter:  ratingAfter,
		}
	}

	tournamentsByMatch, err := s.tournamentsByMatch(ctx, order)
	if err != nil {
		return nil, err
	}

	result := buildMatchesResponse(matchesMap, order)
	m := result[0]
	score := make(map[string]MatchPlayer, len(m.Players))
	for pid, p := range m.Players {
		score[pid] = MatchPlayer{
			RatingStaked: p.RatingStaked,
			RatingEarned: p.RatingEarned,
			Score:        p.Score,
			RatingAfter:  p.RatingAfter,
		}
	}

	match := Match{
		Id:         m.Id,
		GameId:     m.GameId,
		GameName:   m.GameName,
		Date:       m.Date,
		Score:      score,
		HasMarkets: m.HasMarkets,
	}
	if ts := tournamentsByMatch[m.Id]; len(ts) > 0 {
		match.Tournaments = &ts
	}

	return GetMatchById200JSONResponse{Status: "success", Data: match}, nil
}

func (s *StrictServer) UpdateMatch(ctx context.Context, request UpdateMatchRequestObject) (UpdateMatchResponseObject, error) {
	gameID, playerScores, err := parseMatchScores(request.Body.GameId, request.Body.Score)
	if err != nil {
		return UpdateMatch400JSONResponse{Status: "fail", Message: err.Error()}, nil
	}

	_, err = s.api.MatchService.UpdateMatch(ctx, request.Id, gameID, playerScores, request.Body.Date, derefStringSlice(request.Body.TournamentIds))
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
