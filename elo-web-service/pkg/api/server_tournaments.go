package api

import (
	"context"
	"errors"
	"strconv"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) ListTournaments(ctx context.Context, _ ListTournamentsRequestObject) (ListTournamentsResponseObject, error) {
	rows, err := s.api.TournamentService.ListTournaments(ctx)
	if err != nil {
		return nil, err
	}

	tournamentsMap := map[int32]*Tournament{}
	order := []int32{}
	for _, r := range rows {
		if _, ok := tournamentsMap[r.TournamentID]; !ok {
			t := Tournament{
				Id:        strconv.FormatInt(int64(r.TournamentID), 10),
				Name:      r.TournamentName,
				StartDate: r.StartDate.Time,
				EndDate:   r.EndDate.Time,
				Players:   []int{},
			}
			tournamentsMap[r.TournamentID] = &t
			order = append(order, r.TournamentID)
		}
		if r.PlayerID.Valid {
			tournamentsMap[r.TournamentID].Players = append(tournamentsMap[r.TournamentID].Players, int(r.PlayerID.Int32))
		}
	}

	result := make([]Tournament, 0, len(order))
	for _, id := range order {
		result = append(result, *tournamentsMap[id])
	}

	return ListTournaments200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) GetTournament(ctx context.Context, request GetTournamentRequestObject) (GetTournamentResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return GetTournament400JSONResponse{Status: "fail", Message: "invalid tournament id"}, nil
	}

	rows, err := s.api.TournamentService.GetTournament(ctx, int32(idInt))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetTournament404JSONResponse{Status: "fail", Message: "tournament not found"}, nil
	}

	t := Tournament{
		Id:        strconv.Itoa(idInt),
		Name:      rows[0].TournamentName,
		StartDate: rows[0].StartDate.Time,
		EndDate:   rows[0].EndDate.Time,
		Players:   []int{},
	}
	for _, r := range rows {
		if r.PlayerID.Valid {
			t.Players = append(t.Players, int(r.PlayerID.Int32))
		}
	}

	return GetTournament200JSONResponse{Status: "success", Data: t}, nil
}

func (s *StrictServer) CreateTournament(ctx context.Context, request CreateTournamentRequestObject) (CreateTournamentResponseObject, error) {
	if request.Body.Name == "" {
		return CreateTournament400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}
	if !request.Body.EndDate.After(request.Body.StartDate) {
		return CreateTournament400JSONResponse{Status: "fail", Message: "end_date must be after start_date"}, nil
	}

	playerIDs := tournamentPlayerIDs(request.Body.PlayerIds)

	tournament, err := s.api.TournamentService.CreateTournament(ctx, request.Body.Name, request.Body.StartDate, request.Body.EndDate, playerIDs)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreateTournament409JSONResponse{Status: "fail", Message: "tournament with this name already exists"}, nil
		}
		return nil, err
	}

	return CreateTournament200JSONResponse{Status: "success", Data: tournamentToAPI(tournament, playerIDs)}, nil
}

func (s *StrictServer) UpdateTournament(ctx context.Context, request UpdateTournamentRequestObject) (UpdateTournamentResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return UpdateTournament400JSONResponse{Status: "fail", Message: "invalid tournament id"}, nil
	}
	if request.Body.Name == "" {
		return UpdateTournament400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}
	if !request.Body.EndDate.After(request.Body.StartDate) {
		return UpdateTournament400JSONResponse{Status: "fail", Message: "end_date must be after start_date"}, nil
	}

	playerIDs := tournamentPlayerIDs(request.Body.PlayerIds)

	tournament, err := s.api.TournamentService.UpdateTournament(ctx, int32(idInt), request.Body.Name, request.Body.StartDate, request.Body.EndDate, playerIDs)
	if err != nil {
		switch {
		case errors.Is(err, elo.ErrTournamentMemberHasMatches), errors.Is(err, elo.ErrTournamentDatesNarrowEloRange):
			return UpdateTournament409JSONResponse{Status: "fail", Message: err.Error()}, nil
		case db.IsUniqueViolation(err):
			return UpdateTournament409JSONResponse{Status: "fail", Message: "tournament with this name already exists"}, nil
		case db.IsNoRows(err):
			return UpdateTournament404JSONResponse{Status: "fail", Message: "tournament not found"}, nil
		default:
			return nil, err
		}
	}

	return UpdateTournament200JSONResponse{Status: "success", Data: tournamentToAPI(tournament, playerIDs)}, nil
}

func (s *StrictServer) DeleteTournament(ctx context.Context, request DeleteTournamentRequestObject) (DeleteTournamentResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return DeleteTournament400JSONResponse{Status: "fail", Message: "invalid tournament id"}, nil
	}

	_, err = s.api.TournamentService.DeleteTournament(ctx, int32(idInt))
	if err != nil {
		switch {
		case errors.Is(err, elo.ErrTournamentHasMembers):
			return DeleteTournament409JSONResponse{Status: "fail", Message: err.Error()}, nil
		case db.IsNoRows(err):
			return DeleteTournament404JSONResponse{Status: "fail", Message: "tournament not found"}, nil
		default:
			return nil, err
		}
	}

	return DeleteTournament200JSONResponse{Status: "success", Message: "Tournament deleted"}, nil
}

func (s *StrictServer) GetTournamentStats(ctx context.Context, request GetTournamentStatsRequestObject) (GetTournamentStatsResponseObject, error) {
	idInt, err := strconv.Atoi(request.Id)
	if err != nil {
		return GetTournamentStats400JSONResponse{Status: "fail", Message: "invalid tournament id"}, nil
	}

	rows, err := s.api.TournamentService.GetStats(ctx, int32(idInt))
	if err != nil {
		return nil, err
	}

	players := make([]TournamentStatsPlayer, 0, len(rows))
	for _, r := range rows {
		players = append(players, TournamentStatsPlayer{
			PlayerId:     int(r.PlayerID),
			MatchesCount: int(r.MatchesCount),
			First:        int(r.FirstCount),
			Second:       int(r.SecondCount),
			Third:        int(r.ThirdCount),
			Fourth:       int(r.FourthCount),
		})
	}

	return GetTournamentStats200JSONResponse{Status: "success", Data: TournamentStats{Players: players}}, nil
}

// tournamentPlayerIDs converts the optional request player IDs to int32.
func tournamentPlayerIDs(ids *[]int) []int32 {
	if ids == nil {
		return nil
	}
	out := make([]int32, 0, len(*ids))
	for _, p := range *ids {
		out = append(out, int32(p))
	}
	return out
}

// tournamentToAPI maps a db.Tournament plus a known player set to the API model.
func tournamentToAPI(t db.Tournament, playerIDs []int32) Tournament {
	players := make([]int, 0, len(playerIDs))
	for _, p := range playerIDs {
		players = append(players, int(p))
	}
	return Tournament{
		Id:        strconv.Itoa(int(t.ID)),
		Name:      t.Name,
		StartDate: t.StartDate.Time,
		EndDate:   t.EndDate.Time,
		Players:   players,
	}
}
