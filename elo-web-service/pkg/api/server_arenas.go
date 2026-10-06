package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// arenaFilterFromAPI converts the wire filter into the domain one, parsing
// tolerant wire-form ids.
func arenaFilterFromAPI(f *MatchFilter) elo.MatchFilter {
	var out elo.MatchFilter
	if f == nil {
		return out
	}
	out.DateFrom = f.DateFrom
	out.DateTo = f.DateTo
	for _, g := range f.GameIds {
		out.GameIDs = append(out.GameIDs, id.ID(g))
	}
	for _, t := range f.TagIds {
		out.TagIDs = append(out.TagIDs, id.ID(t))
	}
	return out
}

func matchFilterToAPI(f elo.MatchFilter) *MatchFilter {
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
	return &out
}

func arenaToAPI(a elo.Arena) Arena {
	out := Arena{
		Id:                    Base58ID(a.ID),
		Name:                  a.Name,
		Camp:                  a.Camp,
		Filter:                matchFilterToAPI(a.Filter),
		Settings:              ArenaSettings{},
		SettingsSchemaVersion: a.SettingsVersion,
	}
	if len(a.SettingsRaw) > 0 {
		_ = json.Unmarshal(a.SettingsRaw, &out.Settings)
	}
	if a.Camp {
		out.Filter = nil
		out.StartsAt = a.StartsAt
		out.EndsAt = a.EndsAt
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
	appendAll := func(arenas []elo.ArenaWithCount, err error) error {
		if err != nil {
			return err
		}
		for _, a := range arenas {
			out := arenaToAPI(a.Arena)
			count := a.MatchesCount
			out.MatchesCount = &count
			if a.Camp {
				// Camp participants are derived from the settlements — the
				// match-form default-check rule and player dropdown need them
				// offline (ADR-27).
				ids := make([]Base58ID, 0, len(a.CampPlayerIds))
				for _, pid := range a.CampPlayerIds {
					ids = append(ids, Base58ID(pid))
				}
				out.PlayerIds = &ids
			}
			data = append(data, out)
		}
		return nil
	}

	switch {
	case request.Params.Kind != nil && *request.Params.Kind != "":
		if err := appendAll(s.api.ArenaService.ListArenasByKind(ctx, string(*request.Params.Kind))); err != nil {
			return nil, err
		}
	case request.Params.TournamentId != nil && *request.Params.TournamentId != "":
		arena, err := s.api.ArenaService.GetArenaByTournament(ctx, parseIDParam(*request.Params.TournamentId))
		if err != nil {
			if db.IsNoRows(err) {
				return ListArenas200JSONResponse{Status: StatusSuccess, Data: data}, nil
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
		if err := appendAll(s.api.ArenaService.ListArenas(ctx)); err != nil {
			return nil, err
		}
	}

	return ListArenas200JSONResponse{Status: StatusSuccess, Data: data}, nil
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
		return CreateArena400JSONResponse{Status: StatusFail, Message: "invalid settings document"}, nil
	}
	arena, err := s.api.ArenaService.CreateArena(ctx, currentActorID(ctx), elo.ArenaWriteOpts{
		Name:        request.Body.Name,
		Camp:        request.Body.Camp != nil && *request.Body.Camp,
		StartsAt:    request.Body.StartsAt,
		EndsAt:      request.Body.EndsAt,
		Filter:      arenaFilterFromAPI(request.Body.Filter),
		SettingsRaw: settings,
	})
	if msg, ok := invalidSettings(err); ok {
		return CreateArena400JSONResponse{Status: StatusFail, Message: msg}, nil
	}
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return CreateArena400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			return nil, err
		}
	}
	return CreateArena200JSONResponse{Status: StatusSuccess, Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) GetArena(ctx context.Context, request GetArenaRequestObject) (GetArenaResponseObject, error) {
	arena, err := s.api.ArenaService.GetArena(ctx, parseIDParam(request.Id))
	if err != nil {
		if db.IsNoRows(err) {
			return GetArena404JSONResponse{Status: StatusFail, Message: "Arena not found"}, nil
		}
		return nil, err
	}
	return GetArena200JSONResponse{Status: StatusSuccess, Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) UpdateArena(ctx context.Context, request UpdateArenaRequestObject) (UpdateArenaResponseObject, error) {
	settings, err := json.Marshal(request.Body.Settings)
	if err != nil {
		return UpdateArena400JSONResponse{Status: StatusFail, Message: "invalid settings document"}, nil
	}
	arena, err := s.api.ArenaService.UpdateArena(ctx, currentActorID(ctx), parseIDParam(request.Id), elo.ArenaWriteOpts{
		Name:        request.Body.Name,
		Camp:        request.Body.Camp != nil && *request.Body.Camp,
		StartsAt:    request.Body.StartsAt,
		EndsAt:      request.Body.EndsAt,
		Filter:      arenaFilterFromAPI(request.Body.Filter),
		SettingsRaw: settings,
	})
	if msg, ok := invalidSettings(err); ok {
		return UpdateArena400JSONResponse{Status: StatusFail, Message: msg}, nil
	}
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusBadRequest:
			return UpdateArena400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case http.StatusConflict:
			return UpdateArena409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			if db.IsNoRows(err) {
				return UpdateArena404JSONResponse{Status: StatusFail, Message: "Arena not found"}, nil
			}
			return nil, err
		}
	}
	return UpdateArena200JSONResponse{Status: StatusSuccess, Data: arenaToAPI(arena)}, nil
}

func (s *StrictServer) DeleteArena(ctx context.Context, request DeleteArenaRequestObject) (DeleteArenaResponseObject, error) {
	_, err := s.api.ArenaService.DeleteArena(ctx, currentActorID(ctx), parseIDParam(request.Id))
	if err != nil {
		switch domainStatusCode(err) {
		case http.StatusConflict:
			return DeleteArena409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			if db.IsNoRows(err) {
				return DeleteArena404JSONResponse{Status: StatusFail, Message: "Arena not found"}, nil
			}
			return nil, err
		}
	}
	return DeleteArena200JSONResponse{Status: StatusSuccess, Message: "Arena deleted"}, nil
}

func (s *StrictServer) GetArenaPlayers(ctx context.Context, request GetArenaPlayersRequestObject) (GetArenaPlayersResponseObject, error) {
	arenaID := parseIDParam(request.Id)
	players, err := s.api.ArenaService.GetArenaPlayers(ctx, arenaID)
	if err != nil {
		if db.IsNoRows(err) {
			return GetArenaPlayers404JSONResponse{Status: StatusFail, Message: "Arena not found"}, nil
		}
		return nil, err
	}

	// Rank-change history: the same snapshot offsets the /players page uses.
	// A missing point (no settlement yet at that moment) stays nil.
	now := time.Now()
	dayAgo, err := s.api.ArenaService.GetArenaPlayersAt(ctx, arenaID, now.Add(-12*time.Hour))
	if err != nil {
		return nil, err
	}
	weekAgo, err := s.api.ArenaService.GetArenaPlayersAt(ctx, arenaID, now.Add(-7*24*time.Hour+12*time.Hour))
	if err != nil {
		return nil, err
	}
	dayByPlayer := arenaPlayersByID(dayAgo)
	weekByPlayer := arenaPlayersByID(weekAgo)

	data := make([]ArenaPlayer, 0, len(players))
	for _, p := range players {
		ap := ArenaPlayer{
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
		}
		dayPoint, dayOK := dayByPlayer[p.ID]
		weekPoint, weekOK := weekByPlayer[p.ID]
		ap.RankHistory = &struct {
			DayAgo  ArenaRankPoint `json:"day_ago"`
			WeekAgo ArenaRankPoint `json:"week_ago"`
		}{
			DayAgo:  arenaRankPoint(dayPoint, dayOK),
			WeekAgo: arenaRankPoint(weekPoint, weekOK),
		}
		data = append(data, ap)
	}
	return GetArenaPlayers200JSONResponse{Status: StatusSuccess, Data: data}, nil
}

func arenaPlayersByID(players []elo.ArenaPlayer) map[id.ID]elo.ArenaPlayer {
	out := make(map[id.ID]elo.ArenaPlayer, len(players))
	for _, p := range players {
		out[p.ID] = p
	}
	return out
}

func arenaRankPoint(p elo.ArenaPlayer, ok bool) ArenaRankPoint {
	if !ok {
		return ArenaRankPoint{Rating: 0, League: nil, Rank: nil}
	}
	return ArenaRankPoint{Rating: p.Rating, League: p.League, Rank: p.Rank}
}

// Feed event discriminators (ADR-32).
const (
	feedEventMatch      = "match"
	feedEventCorrection = "correction"
	feedEventMarket     = "market"
)

// arenaFeedCursor is the pagination token for the arena and home feeds: the
// last event's (date, type, id) tuple plus the active match filters, so
// continuation requests carry only the token. The full tuple closes the
// date-only cursor's same-timestamp straddle.
type arenaFeedCursor struct {
	Date     string  `json:"date"`
	Type     string  `json:"type"`
	ID       string  `json:"id"`
	PlayerID *string `json:"player_id,omitempty"`
	ClubID   *string `json:"club_id,omitempty"`
	GameID   *string `json:"game_id,omitempty"`
}

func encodeArenaFeedCursor(playerID, clubID, gameID *string, date time.Time, eventType string, eventID id.ID) string {
	token, _ := json.Marshal(arenaFeedCursor{
		Date:     date.UTC().Format(time.RFC3339Nano),
		Type:     eventType,
		ID:       string(eventID),
		PlayerID: playerID,
		ClubID:   clubID,
		GameID:   gameID,
	})
	return base64.StdEncoding.EncodeToString(token)
}

func decodeArenaFeedCursor(token string) (arenaFeedCursor, pgtype.Timestamptz, error) {
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return arenaFeedCursor{}, pgtype.Timestamptz{}, err
	}
	var c arenaFeedCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return arenaFeedCursor{}, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return arenaFeedCursor{}, pgtype.Timestamptz{}, err
	}
	return c, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

// feedRequest carries the parsed parameters shared by the arena feed
// (GET /arenas/{id}/feed) and the home feed (GET /feed) endpoints (ADR-32).
type feedRequest struct {
	arenaID id.ID
	// includeSettlements merges the correction and market-resolution events
	// into the stream. They settle only into the global arena (ADR-24), so it
	// is the only arena whose feed carries them.
	includeSettlements bool
	// includeCoop merges coop matches (ADR-33) into the stream. They belong to
	// no arena (the membership function rejects their mode), so only the home
	// feed carries them.
	includeCoop              bool
	playerID, clubID, gameID *string
	cursorDate               pgtype.Timestamptz
	cursorType               pgtype.Text
	cursorID                 *id.ID
	limit                    int32
}

// parseFeedRequest applies the cursor-or-query-params convention shared by the
// paginated list endpoints: on continuation the cursor token carries the
// filters (in canonical id form), on page 1 they come from the query (wire
// form) and are parsed tolerantly.
func parseFeedRequest(arenaID id.ID, includeSettlements, includeCoop bool, playerId, clubId, gameId, next *string, limitParam *int) (feedRequest, error) {
	req := feedRequest{
		arenaID:            arenaID,
		includeSettlements: includeSettlements,
		includeCoop:        includeCoop,
		limit:              30,
	}
	if next != nil && *next != "" {
		c, date, err := decodeArenaFeedCursor(*next)
		if err != nil {
			return req, err
		}
		req.playerID, req.clubID, req.gameID = c.PlayerID, c.ClubID, c.GameID
		req.cursorDate = date
		req.cursorType = pgtype.Text{String: c.Type, Valid: true}
		cid := id.ID(c.ID)
		req.cursorID = &cid
	} else {
		if playerId != nil && *playerId != "" {
			p := string(parseIDParam(*playerId))
			req.playerID = &p
		}
		if clubId != nil && *clubId != "" {
			cl := string(parseIDParam(*clubId))
			req.clubID = &cl
		}
		if gameId != nil && *gameId != "" {
			g := string(parseIDParam(*gameId))
			req.gameID = &g
		}
	}
	if limitParam != nil && *limitParam > 0 && *limitParam <= 100 {
		req.limit = int32(*limitParam)
	}
	return req, nil
}

// serveFeedPage selects one page of feed event keys, fetches the payloads per
// type in bulk and assembles the response in the keys' order.
func (s *StrictServer) serveFeedPage(ctx context.Context, req feedRequest) (FeedPage, error) {
	keys, err := s.api.ArenaService.ListArenaFeedEvents(ctx, db.ListArenaFeedEventsParams{
		ArenaID:            req.arenaID,
		IncludeSettlements: req.includeSettlements,
		IncludeCoop:        req.includeCoop,
		CursorDate:         req.cursorDate,
		CursorType:         req.cursorType,
		CursorID:           req.cursorID,
		PlayerID:           idPtr(req.playerID),
		ClubID:             idPtr(req.clubID),
		GameID:             idPtr(req.gameID),
		Limit:              req.limit,
	})
	if err != nil {
		return FeedPage{}, err
	}

	matchIDs := make([]id.ID, 0, len(keys))
	correctionIDs := make([]id.ID, 0)
	marketIDs := make([]id.ID, 0)
	for _, k := range keys {
		switch k.EventType {
		case feedEventMatch:
			matchIDs = append(matchIDs, k.ID)
		case feedEventCorrection:
			correctionIDs = append(correctionIDs, k.ID)
		case feedEventMarket:
			marketIDs = append(marketIDs, k.ID)
		}
	}

	matches, err := s.feedMatches(ctx, req.arenaID, matchIDs)
	if err != nil {
		return FeedPage{}, err
	}
	corrections, err := s.feedCorrections(ctx, correctionIDs)
	if err != nil {
		return FeedPage{}, err
	}
	markets, err := s.marketsByIDs(ctx, marketIDs)
	if err != nil {
		return FeedPage{}, err
	}

	data := make([]FeedEvent, 0, len(keys))
	for _, k := range keys {
		var event FeedEvent
		switch k.EventType {
		case feedEventMatch:
			m, ok := matches[k.ID]
			if !ok {
				continue
			}
			if err := event.FromFeedMatchEvent(FeedMatchEvent{Type: FeedMatchEventTypeMatch, Data: m}); err != nil {
				return FeedPage{}, err
			}
		case feedEventCorrection:
			c, ok := corrections[k.ID]
			if !ok {
				continue
			}
			if err := event.FromFeedCorrectionEvent(FeedCorrectionEvent{Type: FeedCorrectionEventTypeCorrection, Data: c}); err != nil {
				return FeedPage{}, err
			}
		case feedEventMarket:
			m, ok := markets[k.ID]
			if !ok {
				continue
			}
			if err := event.FromFeedMarketEvent(FeedMarketEvent{Type: FeedMarketEventTypeMarket, Data: m}); err != nil {
				return FeedPage{}, err
			}
		}
		data = append(data, event)
	}

	var next *string
	if int32(len(keys)) == req.limit {
		last := keys[len(keys)-1]
		token := encodeArenaFeedCursor(req.playerID, req.clubID, req.gameID, last.SortDate.Time, last.EventType, last.ID)
		next = &token
	}
	return FeedPage{Status: StatusSuccess, Data: data, Next: next}, nil
}

// feedMatches fetches the payload rows for the page's match events and
// assembles them into the API Match shape (same per-player settlement data the
// former arena match list produced).
func (s *StrictServer) feedMatches(ctx context.Context, arenaID id.ID, ids []id.ID) (map[id.ID]Match, error) {
	out := make(map[id.ID]Match, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.api.ArenaService.ListFeedMatchesWithPlayers(ctx, db.ListFeedMatchesWithPlayersParams{
		ArenaID: arenaID,
		Ids:     ids,
	})
	if err != nil {
		return nil, err
	}

	matchesMap := make(map[id.ID]*tempMatch, len(ids))
	order := make([]id.ID, 0, len(ids))
	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:             r.MatchID,
				GameId:         r.GameID,
				GameName:       r.GameName,
				Date:           r.Date.Time,
				Players:        make(map[id.ID]matchPlayerJson),
				HasMarkets:     r.HasMarkets,
				Mode:           r.Mode,
				GameScore:      r.GameScore,
				GameWon:        r.GameWon,
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

	campsByMatch, err := s.campsByMatch(ctx, order)
	if err != nil {
		return nil, err
	}
	tournamentByMatch, err := s.tournamentByMatch(ctx, order)
	if err != nil {
		return nil, err
	}

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
			Mode:       MatchesMatchMode(m.Mode),
			GameScore:  float8Ptr(m.GameScore),
			GameWon:    boolPtr(m.GameWon),
		}
		if cs := campsByMatch[m.Id]; len(cs) > 0 {
			match.Camps = &cs
		}
		if t, ok := tournamentByMatch[m.Id]; ok {
			tt := t
			match.Tournament = &tt
		}
		if m.CalculatorKind.Valid {
			kind := m.CalculatorKind.String
			match.CalculatorKind = &kind
		}
		out[mid] = match
	}
	return out, nil
}

// feedCorrections fetches the payload rows for the page's correction events.
func (s *StrictServer) feedCorrections(ctx context.Context, ids []id.ID) (map[id.ID]Correction, error) {
	out := make(map[id.ID]Correction, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.api.CorrectionService.ListCorrectionsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = Correction{
			Id:         Base58ID(r.ID),
			PlayerId:   Base58ID(r.PlayerID),
			PlayerName: r.PlayerName,
			Diff:       r.Diff,
			Date:       r.Date.Time,
		}
	}
	return out, nil
}

func (s *StrictServer) ListArenaFeed(ctx context.Context, request ListArenaFeedRequestObject) (ListArenaFeedResponseObject, error) {
	req, err := parseFeedRequest(
		parseIDParam(request.Id),
		parseIDParam(request.Id) == elo.GlobalArenaID,
		false,
		request.Params.PlayerId, request.Params.ClubId, request.Params.GameId,
		request.Params.Next, request.Params.Limit,
	)
	if err != nil {
		return ListArenaFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
	}
	page, err := s.serveFeedPage(ctx, req)
	if err != nil {
		return nil, err
	}
	return ListArenaFeed200JSONResponse(page), nil
}

func (s *StrictServer) ListHomeFeed(ctx context.Context, request ListHomeFeedRequestObject) (ListHomeFeedResponseObject, error) {
	// The home feed (ADR-32) is the extensible main-page surface. Today it is
	// the global arena's event set plus the coop matches (ADR-33) — content
	// that affects no rating joins here, never the global arena's own feed.
	req, err := parseFeedRequest(
		elo.GlobalArenaID, true, true,
		request.Params.PlayerId, request.Params.ClubId, request.Params.GameId,
		request.Params.Next, request.Params.Limit,
	)
	if err != nil {
		return ListHomeFeed400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
	}
	page, err := s.serveFeedPage(ctx, req)
	if err != nil {
		return nil, err
	}
	return ListHomeFeed200JSONResponse(page), nil
}
