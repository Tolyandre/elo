package api

import (
	"context"
	"errors"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func (s *StrictServer) ListTournaments(ctx context.Context, _ ListTournamentsRequestObject) (ListTournamentsResponseObject, error) {
	rows, err := s.api.TournamentService.ListTournaments(ctx)
	if err != nil {
		return nil, err
	}

	tournamentsMap := map[string]*Tournament{}
	order := []string{}
	for _, r := range rows {
		if _, ok := tournamentsMap[r.TournamentID]; !ok {
			t := Tournament{
				Id:        r.TournamentID,
				Name:      r.TournamentName,
				StartDate: r.StartDate.Time,
				EndDate:   r.EndDate.Time,
				Players:   []string{},
			}
			tournamentsMap[r.TournamentID] = &t
			order = append(order, r.TournamentID)
		}
		if r.PlayerID != nil {
			tournamentsMap[r.TournamentID].Players = append(tournamentsMap[r.TournamentID].Players, *r.PlayerID)
		}
	}

	result := make([]Tournament, 0, len(order))
	for _, id := range order {
		result = append(result, *tournamentsMap[id])
	}

	return ListTournaments200JSONResponse{Status: "success", Data: result}, nil
}

func (s *StrictServer) GetTournament(ctx context.Context, request GetTournamentRequestObject) (GetTournamentResponseObject, error) {
	rows, err := s.api.TournamentService.GetTournament(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetTournament404JSONResponse{Status: "fail", Message: "tournament not found"}, nil
	}

	t := Tournament{
		Id:        request.Id,
		Name:      rows[0].TournamentName,
		StartDate: rows[0].StartDate.Time,
		EndDate:   rows[0].EndDate.Time,
		Players:   []string{},
	}
	for _, r := range rows {
		if r.PlayerID != nil {
			t.Players = append(t.Players, *r.PlayerID)
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

	tournament, err := s.api.TournamentService.CreateTournament(ctx, request.Body.Id, request.Body.Name, request.Body.StartDate, request.Body.EndDate, playerIDs)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return CreateTournament409JSONResponse{Status: "fail", Message: "tournament with this name already exists"}, nil
		}
		return nil, err
	}

	return CreateTournament200JSONResponse{Status: "success", Data: tournamentToAPI(tournament, playerIDs)}, nil
}

func (s *StrictServer) UpdateTournament(ctx context.Context, request UpdateTournamentRequestObject) (UpdateTournamentResponseObject, error) {
	if request.Body.Name == "" {
		return UpdateTournament400JSONResponse{Status: "fail", Message: "name is required"}, nil
	}
	if !request.Body.EndDate.After(request.Body.StartDate) {
		return UpdateTournament400JSONResponse{Status: "fail", Message: "end_date must be after start_date"}, nil
	}

	playerIDs := tournamentPlayerIDs(request.Body.PlayerIds)

	tournament, err := s.api.TournamentService.UpdateTournament(ctx, request.Id, request.Body.Name, request.Body.StartDate, request.Body.EndDate, playerIDs)
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
	_, err := s.api.TournamentService.DeleteTournament(ctx, request.Id)
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
	rows, err := s.api.TournamentService.GetStats(ctx, request.Id)
	if err != nil {
		return nil, err
	}

	players := make([]TournamentStatsPlayer, 0, len(rows))
	for _, r := range rows {
		players = append(players, TournamentStatsPlayer{
			PlayerId:     r.PlayerID,
			MatchesCount: int(r.MatchesCount),
			First:        int(r.FirstCount),
			Second:       int(r.SecondCount),
			Third:        int(r.ThirdCount),
			Fourth:       int(r.FourthCount),
		})
	}

	return GetTournamentStats200JSONResponse{Status: "success", Data: TournamentStats{Players: players}}, nil
}

// tournamentPlayerIDs returns the dereferenced slice of player IDs.
func tournamentPlayerIDs(ids *[]string) []string {
	if ids == nil {
		return nil
	}
	return *ids
}

// tournamentToAPI maps a db.Tournament plus a known player set to the API model.
func tournamentToAPI(t db.Tournament, playerIDs []string) Tournament {
	return Tournament{
		Id:        t.ID,
		Name:      t.Name,
		StartDate: t.StartDate.Time,
		EndDate:   t.EndDate.Time,
		Players:   playerIDs,
	}
}
