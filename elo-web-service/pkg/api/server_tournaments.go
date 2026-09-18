package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/db"
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

func (s *StrictServer) StartTournament(ctx context.Context, request StartTournamentRequestObject) (StartTournamentResponseObject, error) {
	var planRaw json.RawMessage
	if request.Body != nil {
		raw, perr := planToCanonicalRaw(request.Body.Plan)
		if perr != nil {
			return StartTournament400JSONResponse{Status: "fail", Message: perr.Error()}, nil
		}
		planRaw = raw
	}
	tid := parseIDParam(request.Id)
	err := s.api.TournamentService.StartTournament(ctx, tid, planRaw, currentActorID(ctx))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return StartTournament400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case http.StatusNotFound:
			return StartTournament404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		case http.StatusConflict:
			return StartTournament409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}
	s.api.broadcastDataChange(true, true)
	return StartTournament200JSONResponse{Status: "success", Message: "Tournament is started"}, nil
}

func (s *StrictServer) CancelTournament(ctx context.Context, request CancelTournamentRequestObject) (CancelTournamentResponseObject, error) {
	err := s.api.TournamentService.CancelTournament(ctx, parseIDParam(request.Id), currentActorID(ctx))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusNotFound:
			return CancelTournament404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		case http.StatusConflict:
			return CancelTournament409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}
	s.api.broadcastDataChange(false, true)
	return CancelTournament200JSONResponse{Status: "success", Message: "Tournament is cancelled"}, nil
}

func (s *StrictServer) GetTournamentBracket(ctx context.Context, request GetTournamentBracketRequestObject) (GetTournamentBracketResponseObject, error) {
	t, rounds, err := s.api.TournamentService.GetBracket(ctx, parseIDParam(request.Id))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusNotFound:
			return GetTournamentBracket404JSONResponse{Status: "fail", Message: "Турнир не найден"}, nil
		default:
			return nil, err
		}
	}
	return GetTournamentBracket200JSONResponse{Status: "success", Data: bracketToAPI(t, rounds)}, nil
}

// planToCanonicalRaw round-trips the wire plan through the strict parser so
// the start action validates exactly what the enumerator's canonical form
// would be (unknown fields rejected, ids-free by construction).
func planToCanonicalRaw(p TournamentPlan) (json.RawMessage, error) {
	plan := bracket.Plan{Elimination: string(p.Elimination)}
	for _, r := range p.Rounds {
		pr := bracket.PlanRound{Track: string(r.Track), Index: r.Index, Promote: r.Promote}
		for _, sl := range r.Slots {
			ps := bracket.PlanSlot{SeatCount: sl.SeatCount}
			for _, seat := range sl.Seats {
				s := bracket.PlanSeat{Kind: string(seat.Kind)}
				if seat.SourceSlot != nil {
					s.SourceSlot = *seat.SourceSlot
				}
				if seat.SourcePlace != nil {
					s.SourcePlace = *seat.SourcePlace
				}
				ps.Seats = append(ps.Seats, s)
			}
			pr.Slots = append(pr.Slots, ps)
		}
		plan.Rounds = append(plan.Rounds, pr)
	}
	if err := plan.Validate(); err != nil {
		return nil, err
	}
	return json.RawMessage(plan.CanonicalJSON()), nil
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

// bracketToAPI maps the service DTO onto the generated bracket schema.
func bracketToAPI(t db.Tournament, rounds []elo.BracketRound) Bracket {
	out := Bracket{
		TournamentId: Base58ID(t.ID),
		Status:       BracketStatus(t.Status),
		Elimination:  BracketElimination(t.Elimination),
		Rounds:       make([]BracketRound, 0, len(rounds)),
	}
	if t.WinnerPlayerID != nil {
		w := Base58ID(*t.WinnerPlayerID)
		out.WinnerPlayerId = &w
	}
	for _, r := range rounds {
		br := BracketRound{
			Track: BracketRoundTrack(r.Track),
			Index: r.Index,
			Slots: make([]BracketSlot, 0, len(r.Slots)),
		}
		for _, sl := range r.Slots {
			bs := BracketSlot{
				Id:       Base58ID(sl.ID),
				GameId:   Base58ID(sl.GameID),
				Position: sl.Position,
				Promote:  sl.Promote,
				Status:   BracketSlotStatus(sl.Status),
				Seats:    make([]BracketSeat, 0, len(sl.Seats)),
				Matches: []struct {
					MatchId Base58ID `json:"match_id"`
				}{},
				Standings: []struct {
					Place    int      `json:"place"`
					PlayerId Base58ID `json:"player_id"`
					Points   int      `json:"points"`
					Promoted bool     `json:"promoted"`
				}{},
			}
			for _, seat := range sl.Seats {
				seatOut := BracketSeat{Position: seat.Position}
				if seat.PlayerID != nil {
					pid := Base58ID(*seat.PlayerID)
					seatOut.PlayerId = &pid
				}
				if seat.SourceSlotID != nil {
					sid := Base58ID(*seat.SourceSlotID)
					seatOut.SourceSlotId = &sid
				}
				if seat.SourcePlace != nil {
					sp := *seat.SourcePlace
					seatOut.SourcePlace = &sp
				}
				bs.Seats = append(bs.Seats, seatOut)
			}
			for _, mid := range sl.MatchIDs {
				bs.Matches = append(bs.Matches, struct {
					MatchId Base58ID `json:"match_id"`
				}{MatchId: Base58ID(mid)})
			}
			for _, st := range sl.Standings {
				bs.Standings = append(bs.Standings, struct {
					Place    int      `json:"place"`
					PlayerId Base58ID `json:"player_id"`
					Points   int      `json:"points"`
					Promoted bool     `json:"promoted"`
				}{
					PlayerId: Base58ID(st.PlayerID),
					Points:   st.Points,
					Place:    st.Place,
					Promoted: st.Promoted,
				})
			}
			br.Slots = append(br.Slots, bs)
		}
		out.Rounds = append(out.Rounds, br)
	}
	return out
}
