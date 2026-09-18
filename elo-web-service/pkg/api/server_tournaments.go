package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Tournament brackets (ADR-26). Registration-time surface: entity CRUD, the
// self-service registration for linked players, and the bracket-plan
// enumeration the organizer picks a shape from. Start / bracket / organizer
// tooling live in the same file as their phases land.

func (s *StrictServer) CreateTournament(ctx context.Context, request CreateTournamentRequestObject) (CreateTournamentResponseObject, error) {
	var tid id.ID
	if request.Body.Id != nil {
		tid = id.ID(*request.Body.Id)
	}
	t, err := s.api.TournamentService.CreateTournament(ctx, tid, tournamentWriteOpts(request.Body, currentActorID(ctx)))
	if err != nil {
		return nil, err
	}
	detail, err := s.api.TournamentService.GetTournamentDetail(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	return CreateTournament200JSONResponse{Status: "success", Data: tournamentToAPI(detail)}, nil
}

func (s *StrictServer) UpdateTournament(ctx context.Context, request UpdateTournamentRequestObject) (UpdateTournamentResponseObject, error) {
	tid := parseIDParam(request.Id)
	_, err := s.api.TournamentService.UpdateTournament(ctx, tid, tournamentWriteOpts(request.Body, currentActorID(ctx)))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return UpdateTournament400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case http.StatusNotFound:
			return UpdateTournament404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		case http.StatusConflict:
			return UpdateTournament409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}
	detail, err := s.api.TournamentService.GetTournamentDetail(ctx, tid)
	if err != nil {
		return nil, err
	}
	return UpdateTournament200JSONResponse{Status: "success", Data: tournamentToAPI(detail)}, nil
}

func (s *StrictServer) GetTournament(ctx context.Context, request GetTournamentRequestObject) (GetTournamentResponseObject, error) {
	detail, err := s.api.TournamentService.GetTournamentDetail(ctx, parseIDParam(request.Id))
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return GetTournament404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		}
		return nil, err
	}
	return GetTournament200JSONResponse{Status: "success", Data: tournamentToAPI(detail)}, nil
}

func (s *StrictServer) ListTournaments(ctx context.Context, request ListTournamentsRequestObject) (ListTournamentsResponseObject, error) {
	rows, err := s.api.TournamentService.ListTournaments(ctx)
	if err != nil {
		return nil, err
	}
	data := make([]Tournament, 0, len(rows))
	for _, t := range rows {
		data = append(data, tournamentToAPI(elo.TournamentDetail{Row: t}))
	}
	return ListTournaments200JSONResponse{Status: "success", Data: data}, nil
}

func (s *StrictServer) RegisterInTournament(ctx context.Context, request RegisterInTournamentRequestObject) (RegisterInTournamentResponseObject, error) {
	code, message, err := s.changeRegistration(ctx, request.Id, true)
	if err != nil {
		return nil, err
	}
	switch code {
	case http.StatusNotFound:
		return RegisterInTournament404JSONResponse{Status: "fail", Message: message}, nil
	case http.StatusConflict:
		return RegisterInTournament409JSONResponse{Status: "fail", Message: message}, nil
	}
	return RegisterInTournament200JSONResponse{Status: "success", Message: "Registered"}, nil
}

func (s *StrictServer) UnregisterFromTournament(ctx context.Context, request UnregisterFromTournamentRequestObject) (UnregisterFromTournamentResponseObject, error) {
	code, message, err := s.changeRegistration(ctx, request.Id, false)
	if err != nil {
		return nil, err
	}
	switch code {
	case http.StatusNotFound:
		return UnregisterFromTournament404JSONResponse{Status: "fail", Message: message}, nil
	case http.StatusConflict:
		return UnregisterFromTournament409JSONResponse{Status: "fail", Message: message}, nil
	}
	return UnregisterFromTournament200JSONResponse{Status: "success", Message: "Withdrawn"}, nil
}

// changeRegistration resolves the caller's linked player (the route sits
// behind RequirePlayerID) and applies the change; returns the HTTP status and
// message for the typed error responses.
func (s *StrictServer) changeRegistration(ctx context.Context, rawID string, join bool) (int, string, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return http.StatusInternalServerError, "", fmt.Errorf("no gin context")
	}
	playerID := MustGetCurrentPlayerID(ginCtx)
	err := s.api.TournamentService.ChangeRegistration(ctx, parseIDParam(rawID), playerID, currentActorID(ctx), join)
	if err == nil {
		s.api.broadcastDataChange(false, true)
		return http.StatusOK, "", nil
	}
	switch domainStatusCode(err) {
	case http.StatusNotFound:
		return http.StatusNotFound, "Турнир не найден", nil
	case http.StatusConflict:
		return http.StatusConflict, err.Error(), nil
	default:
		return http.StatusInternalServerError, "", err
	}
}

func (s *StrictServer) ListTournamentBracketPlans(ctx context.Context, request ListTournamentBracketPlansRequestObject) (ListTournamentBracketPlansResponseObject, error) {
	res, err := s.api.TournamentService.ListBracketPlans(ctx, parseIDParam(request.Id))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return ListTournamentBracketPlans400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case http.StatusNotFound:
			return ListTournamentBracketPlans404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		case http.StatusConflict:
			return ListTournamentBracketPlans409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}
	plans := make([]TournamentPlan, 0, len(res.Plans))
	for _, p := range res.Plans {
		plans = append(plans, planToAPI(p))
	}
	resp := ListTournamentBracketPlans200JSONResponse{Status: "success"}
	resp.Data.Plans = plans
	resp.Data.Truncated = res.Truncated
	resp.Data.Cap = res.Cap
	return resp, nil
}

// ---------------------------------------------------------------------------
// mapping helpers
// ---------------------------------------------------------------------------

func tournamentWriteOpts(body *TournamentInput, actor id.ID) elo.TournamentWriteOpts {
	opts := elo.TournamentWriteOpts{
		Name:               body.Name,
		Elimination:        string(body.Elimination),
		GrandFinalDeadline: body.GrandFinalDeadline,
		ActorUserID:        actor,
	}
	if body.Games != nil {
		for _, g := range *body.Games {
			opts.Games = append(opts.Games, elo.TournamentGameInput{
				GameID: id.ID(g.GameId), Min: g.MinPlayers, Max: g.MaxPlayers,
			})
		}
	}
	if body.ParticipantIds != nil {
		opts.ParticipantIDs = derefIDs(body.ParticipantIds)
	}
	return opts
}

func tournamentToAPI(d elo.TournamentDetail) Tournament {
	t := d.Row
	out := Tournament{
		Id:          Base58ID(t.ID),
		Name:        t.Name,
		Status:      TournamentStatus(t.Status),
		Elimination: TournamentElimination(t.Elimination),
		Games:       []TournamentGame{},
		CreatedAt:   &t.CreatedAt,
	}
	if t.GrandFinalDeadline.Valid {
		out.GrandFinalDeadline = &t.GrandFinalDeadline.Time
	}
	if t.WinnerPlayerID != nil {
		w := Base58ID(*t.WinnerPlayerID)
		out.WinnerPlayerId = &w
	}
	for _, g := range d.Games {
		out.Games = append(out.Games, TournamentGame{
			GameId:     Base58ID(g.GameID),
			MinPlayers: int(g.MinPlayers),
			MaxPlayers: int(g.MaxPlayers),
		})
	}
	if d.Participants != nil {
		ids := make([]Base58ID, 0, len(d.Participants))
		for _, p := range d.Participants {
			ids = append(ids, Base58ID(p))
		}
		out.ParticipantIds = &ids
	}
	return out
}

func planToAPI(p bracket.Plan) TournamentPlan {
	out := TournamentPlan{
		Elimination: TournamentPlanElimination(p.Elimination),
		Rounds:      make([]PlanRound, 0, len(p.Rounds)),
	}
	for _, r := range p.Rounds {
		pr := PlanRound{
			Track:   PlanRoundTrack(r.Track),
			Index:   r.Index,
			Promote: r.Promote,
			Slots:   make([]PlanSlot, 0, len(r.Slots)),
		}
		for _, sl := range r.Slots {
			ps := PlanSlot{SeatCount: sl.SeatCount, Seats: make([]PlanSeat, 0, len(sl.Seats))}
			for _, seat := range sl.Seats {
				s := PlanSeat{Kind: PlanSeatKind(seat.Kind)}
				if seat.SourceSlot != 0 {
					ss := seat.SourceSlot
					s.SourceSlot = &ss
				}
				if seat.SourcePlace != 0 {
					sp := seat.SourcePlace
					s.SourcePlace = &sp
				}
				ps.Seats = append(ps.Seats, s)
			}
			pr.Slots = append(pr.Slots, ps)
		}
		out.Rounds = append(out.Rounds, pr)
	}
	return out
}
