package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// arenaFilterFromAPI converts the wire filter into the domain one, parsing
// tolerant wire-form ids.
func arenaFilterFromAPI(f MatchFilter) elo.MatchFilter {
	out := elo.MatchFilter{
		DateFrom: f.DateFrom,
		DateTo:   f.DateTo,
	}
	for _, g := range f.GameIds {
		out.GameIDs = append(out.GameIDs, id.ID(g))
	}
	for _, t := range f.TagIds {
		out.TagIDs = append(out.TagIDs, id.ID(t))
	}
	if f.TournamentId != nil {
		t := id.ID(*f.TournamentId)
		out.TournamentID = &t
	}
	return out
}

func matchFilterToAPI(f elo.MatchFilter) MatchFilter {
	out := MatchFilter{
		DateFrom: f.DateFrom,
		DateTo:   f.DateTo,
		GameIds:  make([]Base58ID, 0, len(f.GameIDs)),
		TagIds:   make([]Base58ID, 0, len(f.TagIDs)),
	}
	for _, g := range f.GameIDs {
		out.GameIds = append(out.GameIds, Base58ID(g))
	}
	for _, t := range f.TagIDs {
		out.TagIds = append(out.TagIds, Base58ID(t))
	}
	if f.TournamentID != nil {
		t := Base58ID(*f.TournamentID)
		out.TournamentId = &t
	}
	return out
}

func arenaToAPI(a elo.Arena) Arena {
	out := Arena{
		Id:                    Base58ID(a.ID),
		Name:                  a.Name,
		Filter:                matchFilterToAPI(a.Filter),
		Settings:              ArenaSettings{},
		SettingsSchemaVersion: a.SettingsVersion,
	}
	if len(a.SettingsRaw) > 0 {
		_ = json.Unmarshal(a.SettingsRaw, &out.Settings)
	}
	if a.GameID != nil {
		g := Base58ID(*a.GameID)
		out.GameId = &g
	}
	if a.TournamentID != nil {
		t := Base58ID(*a.TournamentID)
		out.TournamentId = &t
	}
	out.StaleAt = a.StaleAt
	return out
}

// invalidSettings maps a settings-document validation failure to a 400
// message; ok=false when err is something else.
func invalidSettings(err error) (string, bool) {
	if errors.Is(err, arenasettings.ErrInvalid) {
		return err.Error(), true
	}
	return "", false
}

func (s *StrictServer) ListArenas(ctx context.Context, request ListArenasRequestObject) (ListArenasResponseObject, error) {
	data := make([]Arena, 0)
	switch {
	case request.Params.TournamentId != nil && *request.Params.TournamentId != "":
		arena, err := s.api.ArenaService.GetArenaByTournament(ctx, parseIDParam(*request.Params.TournamentId))
		if err != nil {
			if db.IsNoRows(err) {
				return ListArenas200JSONResponse{Status: "success", Data: data}, nil
			}
			return nil, err
		}
		out := arenaToAPI(arena)
		count, err := s.arenaMatchesCount(ctx, arena)
		if err != nil {
			return nil, err
		}
		out.MatchesCount = &count
		data = append(data, out)
	case request.Params.GameId != nil && *request.Params.GameId != "":
		arenas, err := s.api.ArenaService.ListArenasForGame(ctx, parseIDParam(*request.Params.GameId))
		if err != nil {
			return nil, err
		}
		for _, a := range arenas {
			out := arenaToAPI(a)
			count, err := s.arenaMatchesCount(ctx, a)
			if err != nil {
				return nil, err
			}
			out.MatchesCount = &count
			data = append(data, out)
		}
	default:
		arenas, err := s.api.ArenaService.ListArenas(ctx)
		if err != nil {
			return nil, err
		}
		for _, a := range arenas {
			out := arenaToAPI(a.Arena)
			count := a.MatchesCount
			out.MatchesCount = &count
			data = append(data, out)
		}
	}

	return ListArenas200JSONResponse{Status: "success", Data: data}, nil
}

// arenaMatchesCount counts the matches meeting the arena's filter for the
// response of the by-game/by-tournament lookups (ListArenas embeds the count).
func (s *StrictServer) arenaMatchesCount(ctx context.Context, a elo.Arena) (int, error) {
	arenas, err := s.api.ArenaService.ListArenas(ctx)
	if err != nil {
		return 0, err
	}
	for _, aw := range arenas {
		if aw.ID == a.ID {
			return aw.MatchesCount, nil
		}
	}
	return 0, nil
}

func (s *StrictServer) CreateArena(ctx context.Context, request CreateArenaRequestObject) (CreateArenaResponseObject, error) {
	settings, err := json.Marshal(request.Body.Settings)
	if err != nil {
		return CreateArena400JSONResponse{Status: "fail", Message: "invalid settings document"}, nil
	}
	arena, err := s.api.ArenaService.CreateArena(ctx, elo.ArenaWriteOpts{
		Name:        request.Body.Name,
		Filter:      arenaFilterFromAPI(request.Body.Filter),
		SettingsRaw: settings,
	})
	if msg, ok := invalidSettings(err); ok {
		return CreateArena400JSONResponse{Status: "fail", Message: msg}, nil
	}
	if err != nil {
		return nil, err
	}
	return CreateArena200JSONResponse{Status: "success", Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) GetArena(ctx context.Context, request GetArenaRequestObject) (GetArenaResponseObject, error) {
	arena, err := s.api.ArenaService.GetArena(ctx, parseIDParam(request.Id))
	if err != nil {
		if db.IsNoRows(err) {
			return GetArena404JSONResponse{Status: "fail", Message: "Arena not found"}, nil
		}
		return nil, err
	}
	return GetArena200JSONResponse{Status: "success", Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) UpdateArena(ctx context.Context, request UpdateArenaRequestObject) (UpdateArenaResponseObject, error) {
	settings, err := json.Marshal(request.Body.Settings)
	if err != nil {
		return UpdateArena400JSONResponse{Status: "fail", Message: "invalid settings document"}, nil
	}
	arena, err := s.api.ArenaService.UpdateArena(ctx, parseIDParam(request.Id), elo.ArenaWriteOpts{
		Name:        request.Body.Name,
		Filter:      arenaFilterFromAPI(request.Body.Filter),
		SettingsRaw: settings,
	})
	if msg, ok := invalidSettings(err); ok {
		return UpdateArena400JSONResponse{Status: "fail", Message: msg}, nil
	}
	if err != nil {
		switch err {
		case elo.ErrArenaIsAutoManaged:
			return UpdateArena409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			if db.IsNoRows(err) {
				return UpdateArena404JSONResponse{Status: "fail", Message: "Arena not found"}, nil
			}
			return nil, err
		}
	}
	return UpdateArena200JSONResponse{Status: "success", Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) DeleteArena(ctx context.Context, request DeleteArenaRequestObject) (DeleteArenaResponseObject, error) {
	_, err := s.api.ArenaService.DeleteArena(ctx, parseIDParam(request.Id))
	if err != nil {
		switch err {
		case elo.ErrArenaIsAutoManaged, elo.ErrGlobalArenaIsPermanent:
			return DeleteArena409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			if db.IsNoRows(err) {
				return DeleteArena404JSONResponse{Status: "fail", Message: "Arena not found"}, nil
			}
			return nil, err
		}
	}
	return DeleteArena200JSONResponse{Status: "success", Message: "Arena deleted"}, nil
}

func (s *StrictServer) GetArenaPlayers(ctx context.Context, request GetArenaPlayersRequestObject) (GetArenaPlayersResponseObject, error) {
	players, err := s.api.ArenaService.GetArenaPlayers(ctx, parseIDParam(request.Id))
	if err != nil {
		if db.IsNoRows(err) {
			return GetArenaPlayers404JSONResponse{Status: "fail", Message: "Arena not found"}, nil
		}
		return nil, err
	}
	data := make([]ArenaPlayer, 0, len(players))
	for _, p := range players {
		data = append(data, ArenaPlayer{
			PlayerId:                  Base58ID(p.ID),
			Name:                      p.Name,
			Rating:                    p.Rating,
			League:                    p.League,
			Rank:                      p.Rank,
			MatchesCount:              p.MatchesCount,
			FirstCount:                p.FirstCount,
			SecondCount:               p.SecondCount,
			ThirdCount:                p.ThirdCount,
			FourthCount:               p.FourthCount,
			MatchesLeftForElite:       p.MatchesLeftForElite,
			WinsNeededForAmateur:      p.WinsNeededForAmateurLower,
			WinsNeededForAmateurUpper: p.WinsNeededForAmateurUpper,
		})
	}
	return GetArenaPlayers200JSONResponse{Status: "success", Data: data}, nil
}

// arenaMatchCursor is the pagination token for the arena match list: the last
// date plus the active filters, so continuation requests carry only the token.
type arenaMatchCursor struct {
	Date     string  `json:"date"`
	PlayerID *string `json:"player_id,omitempty"`
	ClubID   *string `json:"club_id,omitempty"`
	GameID   *string `json:"game_id,omitempty"`
}

func encodeArenaMatchCursor(playerID, clubID, gameID *string, date time.Time) string {
	token, _ := json.Marshal(arenaMatchCursor{
		Date:     date.UTC().Format(time.RFC3339Nano),
		PlayerID: playerID,
		ClubID:   clubID,
		GameID:   gameID,
	})
	return base64.StdEncoding.EncodeToString(token)
}

func decodeArenaMatchCursor(token string) (arenaMatchCursor, pgtype.Timestamptz, error) {
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return arenaMatchCursor{}, pgtype.Timestamptz{}, err
	}
	var c arenaMatchCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return arenaMatchCursor{}, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return arenaMatchCursor{}, pgtype.Timestamptz{}, err
	}
	return c, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

func (s *StrictServer) ListArenaMatches(ctx context.Context, request ListArenaMatchesRequestObject) (ListArenaMatchesResponseObject, error) {
	var playerID, clubID, gameID *string
	var cursorDate pgtype.Timestamptz
	if request.Params.Next != nil && *request.Params.Next != "" {
		c, date, err := decodeArenaMatchCursor(*request.Params.Next)
		if err != nil {
			return ListArenaMatches400JSONResponse{Status: "fail", Message: "Invalid cursor"}, nil
		}
		playerID, clubID, gameID = c.PlayerID, c.ClubID, c.GameID
		cursorDate = date
	} else {
		// Query params carry wire-form ids (Base58 or canonical); the cursor
		// path above already holds canonical ones.
		if request.Params.PlayerId != nil && *request.Params.PlayerId != "" {
			p := string(parseIDParam(*request.Params.PlayerId))
			playerID = &p
		}
		if request.Params.ClubId != nil && *request.Params.ClubId != "" {
			cl := string(parseIDParam(*request.Params.ClubId))
			clubID = &cl
		}
		if request.Params.GameId != nil && *request.Params.GameId != "" {
			g := string(parseIDParam(*request.Params.GameId))
			gameID = &g
		}
	}

	limit := int32(30)
	if request.Params.Limit != nil && *request.Params.Limit > 0 && *request.Params.Limit <= 100 {
		limit = int32(*request.Params.Limit)
	}

	rows, err := s.api.ArenaService.ListArenaMatchesPaginated(ctx, db.ListArenaMatchesPaginatedParams{
		ArenaID:    parseIDParam(request.Id),
		CursorDate: cursorDate,
		PlayerID:   idPtr(playerID),
		ClubID:     idPtr(clubID),
		GameID:     idPtr(gameID),
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}

	matchesMap := make(map[id.ID]*tempMatch)
	order := make([]id.ID, 0)
	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:             r.MatchID,
				GameId:         r.GameID,
				GameName:       r.GameName,
				Date:           r.Date.Time,
				Players:        make(map[id.ID]matchPlayerJson),
				HasMarkets:     r.HasMarkets,
				CalculatorKind: r.CalculatorKind,
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

	data := make([]Match, 0, len(order))
	for _, mid := range order {
		m := matchesMap[mid]
		score := make(IDMap[MatchPlayer], len(m.Players))
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
		if m.CalculatorKind.Valid {
			kind := m.CalculatorKind.String
			match.CalculatorKind = &kind
		}
		data = append(data, match)
	}

	var next *string
	if int32(len(order)) == limit {
		lastID := order[len(order)-1]
		token := encodeArenaMatchCursor(playerID, clubID, gameID, matchesMap[lastID].Date)
		next = &token
	}

	return ListArenaMatches200JSONResponse{Status: "success", Data: data, Next: next}, nil
}
