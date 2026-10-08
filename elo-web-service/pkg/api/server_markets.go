package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// marketParams is the base (non-pointer) type constraint: both Market_Params and
// MarketDetail_Params expose the same discriminator-setting methods on their
// pointer receivers. The pointer type is modeled separately (paramsFiller) so
// buildTypedParams can allocate a fresh value via new(T) and call the
// pointer-receiver methods on its address.
type marketParams interface {
	Market_Params | MarketDetail_Params
}

// paramsFiller is the pointer-receiver method set shared by *Market_Params and
// *MarketDetail_Params.
type paramsFiller[T any] interface {
	*T
	FromMatchWinnerParams(v MatchWinnerParams) error
	FromWinStreakParams(v WinStreakParams) error
	FromMarketsTournamentWinnerParams(v MarketsTournamentWinnerParams) error
}

// marketRow is the common field set of the generated market row shapes (list /
// get / by resolution match); the converters below map each row onto it so
// buildMarket is written once.
type marketRow struct {
	ID                id.ID
	TenantID          id.ID
	MarketType        string
	Status            string
	ResolutionOutcome *id.ID
	ResolutionMatchID *id.ID
	StartsAt          pgtype.Timestamptz
	ClosesAt          pgtype.Timestamptz
	CreatedAt         pgtype.Timestamptz
	ResolvedAt        pgtype.Timestamptz
	BettingClosedAt   pgtype.Timestamptz
	LiquidityB        float64
	TargetPlayerIds   []id.ID
	AllowOtherPlayers pgtype.Bool
	MwGameIds         []id.ID
	WsTargetPlayerID  *id.ID
	WsGameIds         []id.ID
	WinsRequired      pgtype.Int4
	MaxLosses         pgtype.Int4
	TwTournamentID    *id.ID
	TwTournamentName  pgtype.Text
}

func marketRowFromIDs(r db.ListMarketsByIDsRow) marketRow {
	return marketRow{
		ID:                r.ID,
		TenantID:          r.TenantID,
		MarketType:        r.MarketType,
		Status:            r.Status,
		ResolutionOutcome: r.ResolutionOutcome,
		ResolutionMatchID: r.ResolutionMatchID,
		StartsAt:          r.StartsAt,
		ClosesAt:          r.ClosesAt,
		CreatedAt:         r.CreatedAt,
		ResolvedAt:        r.ResolvedAt,
		BettingClosedAt:   r.BettingClosedAt,
		LiquidityB:        r.LiquidityB,
		TargetPlayerIds:   r.TargetPlayerIds,
		AllowOtherPlayers: r.AllowOtherPlayers,
		MwGameIds:         r.MwGameIds,
		WsTargetPlayerID:  r.WsTargetPlayerID,
		WsGameIds:         r.WsGameIds,
		WinsRequired:      r.WinsRequired,
		MaxLosses:         r.MaxLosses,
		TwTournamentID:    r.TwTournamentID,
		TwTournamentName:  r.TwTournamentName,
	}
}

func marketRowFromByMatch(r db.ListMarketsByResolutionMatchRow) marketRow {
	return marketRow{
		ID:                r.ID,
		TenantID:          r.TenantID,
		MarketType:        r.MarketType,
		Status:            r.Status,
		ResolutionOutcome: r.ResolutionOutcome,
		ResolutionMatchID: r.ResolutionMatchID,
		StartsAt:          r.StartsAt,
		ClosesAt:          r.ClosesAt,
		CreatedAt:         r.CreatedAt,
		ResolvedAt:        r.ResolvedAt,
		BettingClosedAt:   r.BettingClosedAt,
		LiquidityB:        r.LiquidityB,
		TargetPlayerIds:   r.TargetPlayerIds,
		AllowOtherPlayers: r.AllowOtherPlayers,
		MwGameIds:         r.MwGameIds,
		WsTargetPlayerID:  r.WsTargetPlayerID,
		WsGameIds:         r.WsGameIds,
		WinsRequired:      r.WinsRequired,
		MaxLosses:         r.MaxLosses,
		TwTournamentID:    r.TwTournamentID,
		TwTournamentName:  r.TwTournamentName,
	}
}

// buildTypedParams converts raw DB columns to the typed params union. It is
// generic over the two generated response shapes (Market_Params and
// MarketDetail_Params). A fresh T is allocated and its address (P) is returned;
// FromMatchWinnerParams and FromWinStreakParams have pointer receivers and
// dereference the receiver, so a nil pointer would panic.
func buildTypedParams[T marketParams, P paramsFiller[T]](marketType string, targetPlayerIds []id.ID, allowOtherPlayers pgtype.Bool, mwGameIDs []id.ID, wsTargetPlayerID *id.ID, wsGameIDs []id.ID, winsRequired pgtype.Int4, maxLosses pgtype.Int4, twTournamentID *id.ID, twTournamentName pgtype.Text) P {
	p := P(new(T))
	switch marketType {
	case "match_winner":
		_ = p.FromMatchWinnerParams(MatchWinnerParams{
			TargetPlayerIds:   targetPlayerIds,
			AllowOtherPlayers: allowOtherPlayers.Bool,
			GameIds:           &mwGameIDs,
		})
	case "win_streak":
		var maxL *int
		if maxLosses.Valid {
			v := int(maxLosses.Int32)
			maxL = &v
		}
		var wsTarget id.ID
		if wsTargetPlayerID != nil {
			wsTarget = *wsTargetPlayerID
		}
		_ = p.FromWinStreakParams(WinStreakParams{
			TargetPlayerId: wsTarget,
			GameIds:        wsGameIDs,
			WinsRequired:   int(winsRequired.Int32),
			MaxLosses:      maxL,
		})
	case "tournament_winner":
		var tournamentName string
		if twTournamentName.Valid {
			tournamentName = twTournamentName.String
		}
		var tournamentID id.ID
		if twTournamentID != nil {
			tournamentID = *twTournamentID
		}
		_ = p.FromMarketsTournamentWinnerParams(MarketsTournamentWinnerParams{
			TournamentId:   tournamentID,
			TournamentName: tournamentName,
		})
	}
	return p
}

// buildTypedMarketParams converts raw DB columns to the typed Market_Params union.
func buildTypedMarketParams(marketType string, targetPlayerIds []id.ID, allowOtherPlayers pgtype.Bool, mwGameIDs []id.ID, wsTargetPlayerID *id.ID, wsGameIDs []id.ID, winsRequired pgtype.Int4, maxLosses pgtype.Int4, twTournamentID *id.ID, twTournamentName pgtype.Text) *Market_Params {
	return buildTypedParams[Market_Params, *Market_Params](marketType, targetPlayerIds, allowOtherPlayers, mwGameIDs, wsTargetPlayerID, wsGameIDs, winsRequired, maxLosses, twTournamentID, twTournamentName)
}

// buildTypedMarketDetailParams same as above but for MarketDetail_Params.
func buildTypedMarketDetailParams(marketType string, targetPlayerIds []id.ID, allowOtherPlayers pgtype.Bool, mwGameIDs []id.ID, wsTargetPlayerID *id.ID, wsGameIDs []id.ID, winsRequired pgtype.Int4, maxLosses pgtype.Int4, twTournamentID *id.ID, twTournamentName pgtype.Text) *MarketDetail_Params {
	return buildTypedParams[MarketDetail_Params, *MarketDetail_Params](marketType, targetPlayerIds, allowOtherPlayers, mwGameIDs, wsTargetPlayerID, wsGameIDs, winsRequired, maxLosses, twTournamentID, twTournamentName)
}

func convertSettlement(details []db.GetSettlementDetailsRow) *[]SettlementDetail {
	s := make([]SettlementDetail, len(details))
	for i, d := range details {
		s[i] = SettlementDetail{
			PlayerId:   d.PlayerID,
			PlayerName: d.PlayerName,
			Staked:     d.Staked,
			Earned:     d.Earned,
		}
	}
	return &s
}

// convertGuarantorPayouts shapes the per-guarantor payout rollup (the
// guarantor-role settlement rows of the market's guarantors; a guarantor who
// also bought has a separate buyer row, so their entry carries only the house
// result) for the response. Returns nil for an empty slice so the field is
// omitted.
func convertGuarantorPayouts(rows []db.GetMarketGuarantorPayoutsRow) *[]SettlementDetail {
	if len(rows) == 0 {
		return nil
	}
	s := make([]SettlementDetail, len(rows))
	for i, r := range rows {
		s[i] = SettlementDetail{
			PlayerId:   r.PlayerID,
			PlayerName: r.PlayerName,
			Staked:     r.Staked,
			Earned:     r.Earned,
		}
	}
	return &s
}

// outcomeDisplayName derives the display name of an outcome on the fly: the
// player's name for player outcomes (renames propagate automatically), fixed
// Russian labels for the rest.
func outcomeDisplayName(kind string, playerName pgtype.Text) string {
	switch kind {
	case "other":
		return "Ничья"
	case "yes":
		return "Да"
	case "no":
		return "Нет"
	}
	if playerName.Valid {
		return playerName.String
	}
	return "?"
}

// buildOutcomes converts one market's outcome rows (canonical order, the AMM
// q-vector layout) into the API shape: live probabilities from the LMSR state,
// shares = the outstanding q, pool = elo spent on the outcome.
func buildOutcomes(rows []db.ListMarketOutcomesWithPoolsRow, liquidityB float64) []MarketsMarketOutcome {
	q := make([]float64, len(rows))
	for i, r := range rows {
		q[i] = r.Q
	}
	probabilities := elo.MarginalProbabilitiesN(q, liquidityB)
	outcomes := make([]MarketsMarketOutcome, len(rows))
	for i, r := range rows {
		outcomes[i] = MarketsMarketOutcome{
			Id:          r.ID,
			Kind:        MarketsMarketOutcomeKind(r.Kind),
			Name:        outcomeDisplayName(r.Kind, r.PlayerName),
			Probability: probabilities[i],
			Shares:      r.Q,
			Pool:        r.Pool,
		}
		if r.PlayerID != nil {
			outcomes[i].PlayerId = r.PlayerID
		}
	}
	return outcomes
}

// buildAllOutcomes groups an explicit market id set's outcome rows (see
// ListMarketOutcomesWithPoolsByIDs) and computes their probabilities per
// market. liquidity must contain each market's liquidity_b keyed by market id.
func buildAllOutcomes(rows []db.ListMarketOutcomesWithPoolsByIDsRow, liquidity map[string]float64) map[string][]MarketsMarketOutcome {
	grouped := make(map[string][]db.ListMarketOutcomesWithPoolsRow, len(liquidity))
	for _, r := range rows {
		grouped[string(r.MarketID)] = append(grouped[string(r.MarketID)], db.ListMarketOutcomesWithPoolsRow{
			ID:         r.ID,
			MarketID:   r.MarketID,
			Kind:       r.Kind,
			PlayerID:   r.PlayerID,
			PlayerName: r.PlayerName,
			Q:          r.Q,
			Pool:       r.Pool,
		})
	}
	result := make(map[string][]MarketsMarketOutcome, len(grouped))
	for marketID, or := range grouped {
		result[marketID] = buildOutcomes(or, liquidity[marketID])
	}
	return result
}

// apiClosesAt shapes closes_at for the response: tournament_winner markets
// carry no deadline of their own (infinity is stored so the expiry scheduler
// never picks them up), so the field reads as null.
func apiClosesAt(marketType string, closesAt pgtype.Timestamptz) *time.Time {
	if !closesAt.Valid || marketType == "tournament_winner" {
		return nil
	}
	t := closesAt.Time
	return &t
}

// buildMarket assembles the API Market from a market row and its outcomes
// already carrying probabilities.
func buildMarket(r marketRow, outcomes []MarketsMarketOutcome) Market {
	m := Market{
		Id:         r.ID,
		TenantId:   Base58ID(r.TenantID),
		MarketType: MarketMarketType(r.MarketType),
		Status:     MarketStatus(r.Status),
		LiquidityB: r.LiquidityB,
		Outcomes:   outcomes,
		Params: buildTypedMarketParams(r.MarketType, r.TargetPlayerIds, r.AllowOtherPlayers,
			r.MwGameIds, r.WsTargetPlayerID, r.WsGameIds, r.WinsRequired, r.MaxLosses,
			r.TwTournamentID, r.TwTournamentName),
	}
	if r.StartsAt.Valid {
		t := r.StartsAt.Time
		m.StartsAt = &t
	}
	m.ClosesAt = apiClosesAt(r.MarketType, r.ClosesAt)
	if r.CreatedAt.Valid {
		t := r.CreatedAt.Time
		m.CreatedAt = &t
	}
	if r.ResolvedAt.Valid {
		t := r.ResolvedAt.Time
		m.ResolvedAt = &t
	}
	if r.BettingClosedAt.Valid {
		t := r.BettingClosedAt.Time
		m.BettingClosedAt = &t
	}
	if r.ResolutionOutcome != nil {
		v := *r.ResolutionOutcome
		m.ResolutionOutcomeId = &v
	}
	if r.ResolutionMatchID != nil {
		v := *r.ResolutionMatchID
		m.ResolutionMatchId = &v
	}
	return m
}

// marketCursor is the continuation token for the closed-markets page: the last
// row's (resolved_at, id) keyset tuple. The list has no filters yet; the
// struct leaves room for them so future filters ride in the token like
// matchCursor's do.
type marketCursor struct {
	ResolvedAt string `json:"resolved_at"` // RFC3339Nano
	ID         string `json:"id"`
}

func encodeMarketCursor(resolvedAt time.Time, marketID id.ID) string {
	b, _ := json.Marshal(marketCursor{
		ResolvedAt: resolvedAt.UTC().Format(time.RFC3339Nano),
		ID:         string(marketID),
	})
	return base64.StdEncoding.EncodeToString(b)
}

func decodeMarketCursor(token string) (pgtype.Timestamptz, *id.ID, error) {
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return pgtype.Timestamptz{}, nil, err
	}
	var c marketCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return pgtype.Timestamptz{}, nil, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.ResolvedAt)
	if err != nil {
		return pgtype.Timestamptz{}, nil, err
	}
	mid := id.ID(c.ID)
	return pgtype.Timestamptz{Time: t, Valid: true}, &mid, nil
}

// marketsByIDs assembles full Market objects (outcomes with pools; for
// resolved markets also the settlement details and guarantor payouts) for an
// explicit id set. Shared by the markets list and the feeds (ADR-32); page
// bounds keep the per-resolved-market detail queries bounded.
func (s *StrictServer) marketsByIDs(ctx context.Context, ids []id.ID) (map[id.ID]Market, error) {
	out := make(map[id.ID]Market, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.api.MarketQueries.ListMarketsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	outcomeRows, err := s.api.MarketQueries.ListMarketOutcomesWithPoolsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	liquidity := make(map[string]float64, len(rows))
	for _, r := range rows {
		liquidity[string(r.ID)] = r.LiquidityB
	}
	outcomes := buildAllOutcomes(outcomeRows, liquidity)

	for _, r := range rows {
		m := buildMarket(marketRowFromIDs(r), outcomes[string(r.ID)])
		if r.Status == "resolved" {
			if details, err := s.api.MarketQueries.GetSettlementDetails(ctx, &r.ID); err == nil {
				m.Settlement = convertSettlement(details)
			}
			if gp, err := s.api.MarketQueries.GetMarketGuarantorPayouts(ctx, r.ID); err == nil {
				m.GuarantorSettlement = convertGuarantorPayouts(gp)
			}
		}
		out[r.ID] = m
	}
	return out, nil
}

func (s *StrictServer) ListMarkets(ctx context.Context, request ListMarketsRequestObject) (ListMarketsResponseObject, error) {
	limit := int32(30)
	if request.Params.Limit != nil && *request.Params.Limit > 0 && *request.Params.Limit <= 100 {
		limit = int32(*request.Params.Limit)
	}

	var cursorDate pgtype.Timestamptz
	var cursorID *id.ID
	if request.Params.ClosedNext != nil && *request.Params.ClosedNext != "" {
		var err error
		cursorDate, cursorID, err = decodeMarketCursor(*request.Params.ClosedNext)
		if err != nil {
			return ListMarkets400JSONResponse{Status: StatusFail, Message: "Invalid cursor"}, nil
		}
	}

	// The active list is small and bounded — returned in full on every page;
	// the closed bucket grows without bound and paginates by
	// (resolved_at, id) keyset.
	activeIDs, err := s.api.MarketQueries.ListActiveMarketIDs(ctx)
	if err != nil {
		return nil, err
	}
	closedKeys, err := s.api.MarketQueries.ListClosedMarketKeys(ctx, db.ListClosedMarketKeysParams{
		CursorDate: cursorDate,
		CursorID:   cursorID,
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}

	ids := make([]id.ID, 0, len(activeIDs)+len(closedKeys))
	ids = append(ids, activeIDs...)
	for _, k := range closedKeys {
		ids = append(ids, k.ID)
	}
	markets, err := s.marketsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	active := make([]Market, 0, len(activeIDs))
	for _, mid := range activeIDs {
		if m, ok := markets[mid]; ok {
			active = append(active, m)
		}
	}
	closed := make([]Market, 0, len(closedKeys))
	for _, k := range closedKeys {
		if m, ok := markets[k.ID]; ok {
			closed = append(closed, m)
		}
	}

	var next *string
	if int32(len(closedKeys)) == limit {
		last := closedKeys[len(closedKeys)-1]
		token := encodeMarketCursor(last.ResolvedAt.Time, last.ID)
		next = &token
	}

	resp := ListMarkets200JSONResponse{Status: StatusSuccess}
	resp.Data.Active = active
	resp.Data.Closed = closed
	resp.Data.Next = next
	return resp, nil
}

func (s *StrictServer) GetMarket(ctx context.Context, request GetMarketRequestObject) (GetMarketResponseObject, error) {
	marketID := parseIDParam(request.Id)

	row, err := s.api.MarketQueries.GetMarket(ctx, marketID)
	if err != nil {
		return GetMarket404JSONResponse{Status: StatusFail, Message: "market not found"}, nil
	}

	if (row.Status == "open" || row.Status == "betting_closed") && row.ClosesAt.Valid && row.ClosesAt.Time.Before(time.Now()) {
		_ = s.api.MarketService.ExpireOverdueMarkets(ctx)
		row, err = s.api.MarketQueries.GetMarket(ctx, marketID)
		if err != nil {
			return nil, err
		}
	}

	outcomeRows, err := s.api.MarketQueries.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return nil, err
	}

	detail := MarketDetail{
		Id:         row.ID,
		TenantId:   Base58ID(row.TenantID),
		MarketType: MarketDetailMarketType(row.MarketType),
		Status:     MarketDetailStatus(row.Status),
		LiquidityB: row.LiquidityB,
		Outcomes:   buildOutcomes(outcomeRows, row.LiquidityB),
		Params: buildTypedMarketDetailParams(row.MarketType, row.TargetPlayerIds, row.AllowOtherPlayers,
			row.MwGameIds, row.WsTargetPlayerID, row.WsGameIds, row.WinsRequired, row.MaxLosses,
			row.TwTournamentID, row.TwTournamentName),
	}
	detail.Guarantees, detail.FeeRate = s.marketGuarantees(ctx, marketID)
	if feeCollected, err := s.api.MarketQueries.GetMarketFeeCollected(ctx, marketID); err == nil && feeCollected > 0 {
		detail.FeeCollected = &feeCollected
	}
	if row.StartsAt.Valid {
		t := row.StartsAt.Time
		detail.StartsAt = &t
	}
	detail.ClosesAt = apiClosesAt(row.MarketType, row.ClosesAt)
	if row.CreatedAt.Valid {
		t := row.CreatedAt.Time
		detail.CreatedAt = &t
	}
	if row.ResolvedAt.Valid {
		t := row.ResolvedAt.Time
		detail.ResolvedAt = &t
	}
	if row.BettingClosedAt.Valid {
		t := row.BettingClosedAt.Time
		detail.BettingClosedAt = &t
	}
	if row.ResolutionOutcome != nil {
		v := *row.ResolutionOutcome
		detail.ResolutionOutcomeId = &v
	}
	if row.ResolutionMatchID != nil {
		v := *row.ResolutionMatchID
		detail.ResolutionMatchId = &v
	}
	if row.Status == "resolved" {
		if details, err := s.api.MarketQueries.GetSettlementDetails(ctx, &marketID); err == nil {
			detail.Settlement = convertSettlement(details)
		}
		if gp, err := s.api.MarketQueries.GetMarketGuarantorPayouts(ctx, marketID); err == nil {
			detail.GuarantorSettlement = convertGuarantorPayouts(gp)
		}
	}

	s.enrichMarketDetailForPlayer(ctx, &detail, marketID, row.TenantID)

	return GetMarket200JSONResponse{Status: StatusSuccess, Data: detail}, nil
}

func (s *StrictServer) GetMarketProbabilityHistory(ctx context.Context, request GetMarketProbabilityHistoryRequestObject) (GetMarketProbabilityHistoryResponseObject, error) {
	points, err := elo.MarketProbabilityHistory(ctx, s.api.MarketQueries, parseIDParam(request.Id))
	if err != nil {
		return GetMarketProbabilityHistory404JSONResponse{Status: StatusFail, Message: "market not found"}, nil
	}
	resp := GetMarketProbabilityHistory200JSONResponse{Status: StatusSuccess}
	resp.Data.Points = make([]struct {
		Probabilities []struct {
			OutcomeId   Base58ID `json:"outcome_id"`
			Probability float64  `json:"probability"`
		} `json:"probabilities"`
		T time.Time `json:"t"`
	}, len(points))
	for i, p := range points {
		resp.Data.Points[i].Probabilities = make([]struct {
			OutcomeId   Base58ID `json:"outcome_id"`
			Probability float64  `json:"probability"`
		}, len(p.Probabilities))
		for j, op := range p.Probabilities {
			resp.Data.Points[i].Probabilities[j].OutcomeId = op.OutcomeID
			resp.Data.Points[i].Probabilities[j].Probability = op.Probability
		}
		resp.Data.Points[i].T = p.PlacedAt
	}
	return resp, nil
}

// enrichMarketDetailForPlayer fills the per-player fields (per-outcome elo
// spent and shares held, reserved, bet limit) when the caller is authenticated
// with a linked player. Projections sum the player's per-buy shares (each pays
// 1 on a win) and spent elo. Failures of the individual reads are non-fatal: a
// missing field stays nil. The bet limit counts against the market's tenant
// main arena (ADR-36 phase 5).
func (s *StrictServer) enrichMarketDetailForPlayer(ctx context.Context, detail *MarketDetail, marketID, tenantID id.ID) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return
	}
	userID, hasUser := tryGetCurrentUserID(ginCtx)
	if !hasUser {
		return
	}
	user, err := s.api.UserService.GetUserByID(ctx, userID)
	if err != nil || user.PlayerID == nil {
		return
	}
	playerID := *user.PlayerID

	myBets, err := s.api.MarketQueries.GetPlayerBetsForMarket(ctx, db.GetPlayerBetsForMarketParams{
		MarketID: marketID,
		PlayerID: playerID,
	})
	if err == nil {
		type position struct {
			outcomeID id.ID
			staked    float64
			shares    float64
		}
		order := make([]id.ID, 0)
		byOutcome := make(map[id.ID]*position)
		for _, b := range myBets {
			pos := byOutcome[b.Outcome]
			if pos == nil {
				pos = &position{outcomeID: b.Outcome}
				byOutcome[b.Outcome] = pos
				order = append(order, b.Outcome)
			}
			pos.staked += b.Cost + b.Fee // elo spent incl. the maker fee
			pos.shares += b.Shares       // shares held (each pays 1 if the outcome wins)
		}
		if len(order) > 0 {
			positions := make([]struct {
				OutcomeId Base58ID `json:"outcome_id"`
				Shares    float64  `json:"shares"`
				Staked    float64  `json:"staked"`
			}, 0, len(order))
			for _, oid := range order {
				pos := byOutcome[oid]
				positions = append(positions, struct {
					OutcomeId Base58ID `json:"outcome_id"`
					Shares    float64  `json:"shares"`
					Staked    float64  `json:"staked"`
				}{OutcomeId: pos.outcomeID, Shares: pos.shares, Staked: pos.staked})
			}
			detail.MyPositions = &positions
		}
	}

	if reserved, err := s.api.MarketQueries.GetPlayerReservedAmount(ctx, playerID); err == nil {
		detail.Reserved = &reserved
	}
	if arenaID, err := s.api.TenantService.FeedArena(ctx, tenantID); err == nil {
		if limit, err := elo.BetLimitForPlayer(ctx, s.api.MarketQueries, arenaID, playerID); err == nil {
			detail.BetLimit = &limit
		}
	}
}

// maxMatchWinnerTargets caps the number of target players (and therefore
// outcomes) on a match_winner market — every outcome needs a chart line and a
// donut segment, so the cardinality stays displayable.
const maxMatchWinnerTargets = 12

func (s *StrictServer) CreateTenantMarket(ctx context.Context, request CreateTenantMarketRequestObject) (CreateTenantMarketResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return CreateTenantMarket401JSONResponse{Status: StatusFail, Message: "authentication required"}, nil
		}
		return nil, err
	}

	body := request.Body

	startsAt := time.Now()
	if body.StartsAt != nil {
		if body.StartsAt.Before(time.Now()) {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "starts_at не может быть в прошлом"}, nil
		}
		startsAt = *body.StartsAt
	}

	params := elo.CreateMarketParams{
		ID:         id.ID(body.Id),
		TenantID:   parseIDParam(request.Id),
		MarketType: string(body.MarketType),
		StartsAt:   startsAt,
		CreatedBy:  user.ID,
	}

	// match_winner and win_streak markets take a deadline; tournament_winner
	// markets are born automatically with their tournament (ADR-35) and can
	// not be created by hand — an unknown type falls through to the default
	// case below.
	switch string(body.MarketType) {
	case "match_winner", "win_streak":
		if body.ClosesAt == nil {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: string(body.MarketType) + " requires closes_at"}, nil
		}
		params.ClosesAt = *body.ClosesAt
	}

	switch string(body.MarketType) {
	case "match_winner":
		if body.TargetPlayerIds == nil || len(*body.TargetPlayerIds) == 0 {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "match_winner requires target_player_ids"}, nil
		}
		if len(*body.TargetPlayerIds) > maxMatchWinnerTargets {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "слишком много целевых игроков"}, nil
		}
		if body.AllowOtherPlayers == nil {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "match_winner requires allow_other_players"}, nil
		}
		// Deduplicate while preserving order.
		seen := make(map[id.ID]bool, len(*body.TargetPlayerIds))
		targets := make([]id.ID, 0, len(*body.TargetPlayerIds))
		for _, tpid := range *body.TargetPlayerIds {
			v := id.ID(tpid)
			if !seen[v] {
				seen[v] = true
				targets = append(targets, v)
			}
		}
		// A single named player without the shared "other" winner leaves a
		// degenerate market: any other player's win would resolve nothing.
		if len(targets) == 1 && !*body.AllowOtherPlayers {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "для рынка с одним целевым игроком нужно разрешить победы других игроков"}, nil
		}
		var gameIDs []id.ID
		if body.GameIds != nil {
			gameIDs = *body.GameIds
		}
		params.MatchWinner = &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   targets,
			AllowOtherPlayers: *body.AllowOtherPlayers,
			GameIDs:           gameIDs,
		}

	case "win_streak":
		if body.TargetPlayerId == nil || *body.TargetPlayerId == "" {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "invalid target_player_id"}, nil
		}
		if body.WinsRequired == nil {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "win_streak requires wins_required"}, nil
		}
		var streakGameIDs []id.ID
		if body.StreakGameIds != nil {
			streakGameIDs = *body.StreakGameIds
		}
		var maxLosses *int32
		if body.MaxLosses != nil {
			v := int32(*body.MaxLosses)
			maxLosses = &v
		}
		params.WinStreak = &elo.WinStreakCreateParams{
			TargetPlayerID: id.ID(*body.TargetPlayerId),
			GameIDs:        streakGameIDs,
			WinsRequired:   int32(*body.WinsRequired),
			MaxLosses:      maxLosses,
		}

	default:
		return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: "unknown market_type: " + string(body.MarketType)}, nil
	}

	market, err := s.api.MarketService.CreateMarket(ctx, params)
	if err != nil {
		// The service validates the path tenant: missing → 404.
		if domainStatusCode(err) == http.StatusNotFound {
			return CreateTenantMarket404JSONResponse{Status: StatusFail, Message: "Tenant not found"}, nil
		}
		// The members_only creation gate (ADR-36 phase 7) is a 400.
		if domainStatusCode(err) == http.StatusBadRequest {
			return CreateTenantMarket400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}

	resp := CreateTenantMarket201JSONResponse{Status: StatusSuccess}
	resp.Data.Id = market.ID
	return resp, nil
}

func (s *StrictServer) PatchMarket(ctx context.Context, request PatchMarketRequestObject) (PatchMarketResponseObject, error) {
	switch string(request.Body.Status) {
	case "betting_closed":
		if err := s.api.MarketService.LockMarketBetting(ctx, parseIDParam(request.Id)); err != nil {
			if errors.Is(err, elo.ErrMarketNotOpen) {
				return PatchMarket409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
			}
			return nil, err
		}
		return PatchMarket200JSONResponse{Status: StatusSuccess, Message: "Betting closed"}, nil
	default:
		return PatchMarket400JSONResponse{Status: StatusFail, Message: "unsupported status transition: " + string(request.Body.Status)}, nil
	}
}

func (s *StrictServer) DeleteMarket(ctx context.Context, request DeleteMarketRequestObject) (DeleteMarketResponseObject, error) {
	if err := s.api.MatchService.DeleteMarketAndRecalculate(ctx, parseIDParam(request.Id)); err != nil {
		if errors.Is(err, elo.ErrMarketNotOpen) {
			return DeleteMarket409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		}
		return nil, err
	}

	// Market deletion also replays ratings, so both lists go stale.
	s.api.Hub.PublishSignal(elo.TopicLobbyMarkets, "markets-changed")
	s.api.broadcastDataChange(true, true)

	return DeleteMarket200JSONResponse{Status: StatusSuccess, Message: "Market deleted"}, nil
}

func (s *StrictServer) PlaceBet(ctx context.Context, request PlaceBetRequestObject) (PlaceBetResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return PlaceBet401JSONResponse{Status: StatusFail, Message: "authentication required"}, nil
		}
		return nil, err
	}
	if user.PlayerID == nil {
		return PlaceBet403JSONResponse{Status: StatusFail, Message: elo.ErrPlayerHasNoLinkedPlayer.Error()}, nil
	}

	body := request.Body
	if body.Shares <= 0 {
		return PlaceBet400JSONResponse{Status: StatusFail, Message: "shares must be positive"}, nil
	}
	// Closed interval: in a one-sided market the live probability legitimately
	// saturates to exactly 0.0 or 1.0 in float64 (a q gap of ~37·b is enough),
	// and the UI sends back the value it displays. The drift check inside
	// PlaceBet compares against the same server-computed value, so the
	// endpoints pass it trivially; values outside [0, 1] are the only garbage.
	if body.ExpectedProbability < 0 || body.ExpectedProbability > 1 {
		return PlaceBet400JSONResponse{Status: StatusFail, Message: "expected_probability must be in [0, 1]"}, nil
	}

	outcome, err := s.api.MarketService.PlaceBet(ctx, id.ID(body.Id), parseIDParam(request.Id), *user.PlayerID, id.ID(body.OutcomeId), body.Shares, body.ExpectedProbability)
	if err != nil {
		switch {
		case errors.Is(err, elo.ErrBetLimitExceeded):
			return PlaceBet422JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketOutcomeNotFound):
			return PlaceBet400JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketMembersOnly):
			// A members_only club's market admits current members only (ADR-36).
			return PlaceBet403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketNotOpen), errors.Is(err, elo.ErrProbabilityChanged), errors.Is(err, elo.ErrMarketNeedsGuarantor):
			return PlaceBet409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	resp := PlaceBet201JSONResponse{Status: StatusSuccess}
	resp.Data.Shares = outcome.Shares
	resp.Data.CostPerShare = outcome.CostPerShare
	resp.Data.Fee = outcome.Fee
	return resp, nil
}

// CreateMarketGuarantee adds the caller's linked player as a guarantor of an
// open market: a wager of {risk amount, maker fee rate} that is reserved
// against the betting limit, is immutable, and grows the market's liquidity
// (b = Σrisk/ln(n); the join reprices prices toward uniform over the fixed q,
// ADR-22) (ADR-20).
func (s *StrictServer) CreateMarketGuarantee(ctx context.Context, request CreateMarketGuaranteeRequestObject) (CreateMarketGuaranteeResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return CreateMarketGuarantee401JSONResponse{Status: StatusFail, Message: "authentication required"}, nil
		}
		return nil, err
	}
	if user.PlayerID == nil {
		return CreateMarketGuarantee403JSONResponse{Status: StatusFail, Message: elo.ErrPlayerHasNoLinkedPlayer.Error()}, nil
	}

	body := request.Body
	if body.RiskAmount <= 0 {
		return CreateMarketGuarantee422JSONResponse{Status: StatusFail, Message: elo.ErrGuaranteeRiskNotPositive.Error()}, nil
	}
	if body.FeeRate < 0 || body.FeeRate > 0.25 {
		return CreateMarketGuarantee422JSONResponse{Status: StatusFail, Message: elo.ErrGuaranteeFeeOutOfRange.Error()}, nil
	}

	outcome, err := s.api.MarketService.JoinAsGuarantee(ctx, id.ID(body.Id), parseIDParam(request.Id), *user.PlayerID, body.RiskAmount, body.FeeRate)
	if err != nil {
		switch {
		case errors.Is(err, elo.ErrMarketNotOpen):
			return CreateMarketGuarantee409JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketMembersOnly):
			// A members_only club's market admits current members only (ADR-36).
			return CreateMarketGuarantee403JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		case errors.Is(err, elo.ErrBetLimitExceeded),
			errors.Is(err, elo.ErrGuaranteeRiskNotPositive),
			errors.Is(err, elo.ErrGuaranteeFeeOutOfRange):
			return CreateMarketGuarantee422JSONResponse{Status: StatusFail, Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	resp := CreateMarketGuarantee201JSONResponse{Status: StatusSuccess}
	resp.Data.RiskAmount = outcome.RiskAmount
	resp.Data.FeeRate = outcome.FeeRate
	resp.Data.LiquidityB = outcome.LiquidityB
	resp.Data.TotalRisk = outcome.TotalRisk
	return resp, nil
}

func (s *StrictServer) GetMarketsByMatchId(ctx context.Context, request GetMarketsByMatchIdRequestObject) (GetMarketsByMatchIdResponseObject, error) {
	matchID := parseIDParam(request.Id)

	rows, err := s.api.MarketQueries.ListMarketsByResolutionMatch(ctx, &matchID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetMarketsByMatchId200JSONResponse{Status: StatusSuccess, Data: []Market{}}, nil
	}

	liquidity := make(map[string]float64, len(rows))
	for _, r := range rows {
		liquidity[string(r.ID)] = r.LiquidityB
	}
	result := make([]Market, 0, len(rows))
	for _, r := range rows {
		outcomeRows, err := s.api.MarketQueries.ListMarketOutcomesWithPools(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		m := buildMarket(marketRowFromByMatch(r), buildOutcomes(outcomeRows, r.LiquidityB))
		if r.Status == "resolved" {
			if details, err := s.api.MarketQueries.GetSettlementDetails(ctx, &r.ID); err == nil {
				m.Settlement = convertSettlement(details)
			}
			if gp, err := s.api.MarketQueries.GetMarketGuarantorPayouts(ctx, r.ID); err == nil {
				m.GuarantorSettlement = convertGuarantorPayouts(gp)
			}
		}
		result = append(result, m)
	}

	return GetMarketsByMatchId200JSONResponse{Status: StatusSuccess, Data: result}, nil
}
