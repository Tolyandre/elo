package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
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
}

// marketRow is the common field set of the generated market row shapes (list /
// get / by resolution match); the converters below map each row onto it so
// buildMarket is written once.
type marketRow struct {
	ID                string
	MarketType        string
	Status            string
	ResolutionOutcome *string
	ResolutionMatchID *string
	StartsAt          pgtype.Timestamptz
	ClosesAt          pgtype.Timestamptz
	CreatedAt         pgtype.Timestamptz
	ResolvedAt        pgtype.Timestamptz
	BettingClosedAt   pgtype.Timestamptz
	LiquidityB        float64
	TargetPlayerIds   []string
	AllowOtherPlayers pgtype.Bool
	MwGameIds         []string
	WsTargetPlayerID  *string
	WsGameIds         []string
	WinsRequired      pgtype.Int4
	MaxLosses         pgtype.Int4
}

func marketRowFromList(r db.ListMarketsRow) marketRow {
	return marketRow{r.ID, r.MarketType, r.Status, r.ResolutionOutcome, r.ResolutionMatchID,
		r.StartsAt, r.ClosesAt, r.CreatedAt, r.ResolvedAt, r.BettingClosedAt, r.LiquidityB,
		r.TargetPlayerIds, r.AllowOtherPlayers, r.MwGameIds, r.WsTargetPlayerID, r.WsGameIds, r.WinsRequired, r.MaxLosses}
}

func marketRowFromByMatch(r db.ListMarketsByResolutionMatchRow) marketRow {
	return marketRow{r.ID, r.MarketType, r.Status, r.ResolutionOutcome, r.ResolutionMatchID,
		r.StartsAt, r.ClosesAt, r.CreatedAt, r.ResolvedAt, r.BettingClosedAt, r.LiquidityB,
		r.TargetPlayerIds, r.AllowOtherPlayers, r.MwGameIds, r.WsTargetPlayerID, r.WsGameIds, r.WinsRequired, r.MaxLosses}
}

// buildTypedParams converts raw DB columns to the typed params union. It is
// generic over the two generated response shapes (Market_Params and
// MarketDetail_Params). A fresh T is allocated and its address (P) is returned;
// FromMatchWinnerParams and FromWinStreakParams have pointer receivers and
// dereference the receiver, so a nil pointer would panic.
func buildTypedParams[T marketParams, P paramsFiller[T]](marketType string, targetPlayerIds []string, allowOtherPlayers pgtype.Bool, mwGameIDs []string, wsTargetPlayerID *string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) P {
	p := P(new(T))
	switch marketType {
	case "match_winner":
		gameIDStrs := mwGameIDs
		_ = p.FromMatchWinnerParams(MatchWinnerParams{
			TargetPlayerIds:   targetPlayerIds,
			AllowOtherPlayers: allowOtherPlayers.Bool,
			GameIds:           &gameIDStrs,
		})
	case "win_streak":
		var maxL *int
		if maxLosses.Valid {
			v := int(maxLosses.Int32)
			maxL = &v
		}
		wsTarget := ""
		if wsTargetPlayerID != nil {
			wsTarget = *wsTargetPlayerID
		}
		_ = p.FromWinStreakParams(WinStreakParams{
			TargetPlayerId: wsTarget,
			GameIds:        wsGameIDs,
			WinsRequired:   int(winsRequired.Int32),
			MaxLosses:      maxL,
		})
	}
	return p
}

// buildTypedMarketParams converts raw DB columns to the typed Market_Params union.
func buildTypedMarketParams(marketType string, targetPlayerIds []string, allowOtherPlayers pgtype.Bool, mwGameIDs []string, wsTargetPlayerID *string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) *Market_Params {
	return buildTypedParams[Market_Params, *Market_Params](marketType, targetPlayerIds, allowOtherPlayers, mwGameIDs, wsTargetPlayerID, wsGameIDs, winsRequired, maxLosses)
}

// buildTypedMarketDetailParams same as above but for MarketDetail_Params.
func buildTypedMarketDetailParams(marketType string, targetPlayerIds []string, allowOtherPlayers pgtype.Bool, mwGameIDs []string, wsTargetPlayerID *string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) *MarketDetail_Params {
	return buildTypedParams[MarketDetail_Params, *MarketDetail_Params](marketType, targetPlayerIds, allowOtherPlayers, mwGameIDs, wsTargetPlayerID, wsGameIDs, winsRequired, maxLosses)
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
// q-vector layout) into the API shape: live prices from the LMSR state, shares
// = the outstanding q, pool = elo spent on the outcome.
func buildOutcomes(rows []db.ListMarketOutcomesWithPoolsRow, liquidityB float64) []MarketsMarketOutcome {
	q := make([]float64, len(rows))
	for i, r := range rows {
		q[i] = r.Q
	}
	prices := elo.MarginalPricesN(q, liquidityB)
	outcomes := make([]MarketsMarketOutcome, len(rows))
	for i, r := range rows {
		outcomes[i] = MarketsMarketOutcome{
			Id:     r.ID,
			Kind:   MarketsMarketOutcomeKind(r.Kind),
			Name:   outcomeDisplayName(r.Kind, r.PlayerName),
			Price:  prices[i],
			Shares: r.Q,
			Pool:   r.Pool,
		}
		if r.PlayerID != nil {
			pid := *r.PlayerID
			outcomes[i].PlayerId = &pid
		}
	}
	return outcomes
}

// buildAllOutcomes groups every market's outcome rows (see
// ListAllMarketOutcomesWithPools) and prices them per market. liquidity must
// contain each market's liquidity_b keyed by market id.
func buildAllOutcomes(rows []db.ListAllMarketOutcomesWithPoolsRow, liquidity map[string]float64) map[string][]MarketsMarketOutcome {
	grouped := make(map[string][]db.ListMarketOutcomesWithPoolsRow, len(liquidity))
	for _, r := range rows {
		grouped[r.MarketID] = append(grouped[r.MarketID], db.ListMarketOutcomesWithPoolsRow{
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

// buildMarket assembles the API Market from a market row and its already-priced
// outcomes.
func buildMarket(r marketRow, outcomes []MarketsMarketOutcome) Market {
	m := Market{
		Id:         r.ID,
		MarketType: MarketMarketType(r.MarketType),
		Status:     MarketStatus(r.Status),
		LiquidityB: r.LiquidityB,
		Outcomes:   outcomes,
		Params: buildTypedMarketParams(r.MarketType, r.TargetPlayerIds, r.AllowOtherPlayers,
			r.MwGameIds, r.WsTargetPlayerID, r.WsGameIds, r.WinsRequired, r.MaxLosses),
	}
	if r.StartsAt.Valid {
		t := r.StartsAt.Time
		m.StartsAt = &t
	}
	if r.ClosesAt.Valid {
		t := r.ClosesAt.Time
		m.ClosesAt = &t
	}
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

func (s *StrictServer) ListMarkets(ctx context.Context, _ ListMarketsRequestObject) (ListMarketsResponseObject, error) {
	rows, err := s.api.MarketService.ListMarkets(ctx)
	if err != nil {
		return nil, err
	}
	outcomeRows, err := s.api.MarketService.ListAllMarketOutcomesWithPools(ctx)
	if err != nil {
		return nil, err
	}
	liquidity := make(map[string]float64, len(rows))
	for _, r := range rows {
		liquidity[r.ID] = r.LiquidityB
	}
	outcomes := buildAllOutcomes(outcomeRows, liquidity)

	active := make([]Market, 0)
	closed := make([]Market, 0)

	for _, r := range rows {
		m := buildMarket(marketRowFromList(r), outcomes[r.ID])

		if r.Status == "open" || r.Status == "betting_closed" {
			active = append(active, m)
		} else {
			if r.Status == "resolved" {
				if details, err := s.api.MarketService.GetSettlementDetails(ctx, &r.ID); err == nil {
					m.Settlement = convertSettlement(details)
				}
				if gp, err := s.api.MarketService.GetMarketGuarantorPayouts(ctx, r.ID); err == nil {
					m.GuarantorSettlement = convertGuarantorPayouts(gp)
				}
			}
			closed = append(closed, m)
		}
	}

	sort.Slice(closed, func(i, j int) bool {
		ti := closed[i].ResolvedAt
		tj := closed[j].ResolvedAt
		if ti == nil && tj == nil {
			return false
		}
		if ti == nil {
			return false
		}
		if tj == nil {
			return true
		}
		return ti.After(*tj)
	})

	return ListMarkets200JSONResponse{
		Status: "success",
		Data: struct {
			Active []Market `json:"active"`
			Closed []Market `json:"closed"`
		}{Active: active, Closed: closed},
	}, nil
}

func (s *StrictServer) GetMarket(ctx context.Context, request GetMarketRequestObject) (GetMarketResponseObject, error) {
	marketID := request.Id

	row, err := s.api.MarketService.GetMarket(ctx, marketID)
	if err != nil {
		return GetMarket404JSONResponse{Status: "fail", Message: "market not found"}, nil
	}

	if (row.Status == "open" || row.Status == "betting_closed") && row.ClosesAt.Valid && row.ClosesAt.Time.Before(time.Now()) {
		_ = s.api.MarketService.ExpireOverdueMarkets(ctx)
		row, err = s.api.MarketService.GetMarket(ctx, marketID)
		if err != nil {
			return nil, err
		}
	}

	outcomeRows, err := s.api.MarketService.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return nil, err
	}

	detail := MarketDetail{
		Id:         row.ID,
		MarketType: MarketDetailMarketType(row.MarketType),
		Status:     MarketDetailStatus(row.Status),
		LiquidityB: row.LiquidityB,
		Outcomes:   buildOutcomes(outcomeRows, row.LiquidityB),
		Guarantors: s.marketGuarantors(ctx, marketID),
		Params: buildTypedMarketDetailParams(row.MarketType, row.TargetPlayerIds, row.AllowOtherPlayers,
			row.MwGameIds, row.WsTargetPlayerID, row.WsGameIds, row.WinsRequired, row.MaxLosses),
	}
	if row.StartsAt.Valid {
		t := row.StartsAt.Time
		detail.StartsAt = &t
	}
	if row.ClosesAt.Valid {
		t := row.ClosesAt.Time
		detail.ClosesAt = &t
	}
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
		if details, err := s.api.MarketService.GetSettlementDetails(ctx, &marketID); err == nil {
			detail.Settlement = convertSettlement(details)
		}
		if gp, err := s.api.MarketService.GetMarketGuarantorPayouts(ctx, marketID); err == nil {
			detail.GuarantorSettlement = convertGuarantorPayouts(gp)
		}
	}

	s.enrichMarketDetailForPlayer(ctx, &detail, marketID)

	return GetMarket200JSONResponse{Status: "success", Data: detail}, nil
}

func (s *StrictServer) GetMarketPriceHistory(ctx context.Context, request GetMarketPriceHistoryRequestObject) (GetMarketPriceHistoryResponseObject, error) {
	points, err := s.api.MarketService.GetMarketPriceHistory(ctx, request.Id)
	if err != nil {
		return GetMarketPriceHistory404JSONResponse{Status: "fail", Message: "market not found"}, nil
	}
	resp := GetMarketPriceHistory200JSONResponse{Status: "success"}
	resp.Data.Points = make([]struct {
		Prices []struct {
			OutcomeId string  `json:"outcome_id"`
			Price     float64 `json:"price"`
		} `json:"prices"`
		T time.Time `json:"t"`
	}, len(points))
	for i, p := range points {
		resp.Data.Points[i].Prices = make([]struct {
			OutcomeId string  `json:"outcome_id"`
			Price     float64 `json:"price"`
		}, len(p.Prices))
		for j, op := range p.Prices {
			resp.Data.Points[i].Prices[j].OutcomeId = op.OutcomeID
			resp.Data.Points[i].Prices[j].Price = op.Price
		}
		resp.Data.Points[i].T = p.PlacedAt
	}
	return resp, nil
}

// enrichMarketDetailForPlayer fills the per-player fields (per-outcome elo
// spent and shares held, reserved, bet limit) when the caller is authenticated
// with a linked player. Projections sum the player's per-buy shares (each pays
// 1 on a win) and spent elo. Failures of the individual reads are non-fatal: a
// missing field stays nil.
func (s *StrictServer) enrichMarketDetailForPlayer(ctx context.Context, detail *MarketDetail, marketID string) {
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

	myBets, err := s.api.MarketService.GetPlayerBetsForMarket(ctx, db.GetPlayerBetsForMarketParams{
		MarketID: marketID,
		PlayerID: playerID,
	})
	if err == nil {
		type position struct {
			outcomeID string
			staked    float64
			shares    float64
		}
		order := make([]string, 0)
		byOutcome := make(map[string]*position)
		for _, b := range myBets {
			pos := byOutcome[b.Outcome]
			if pos == nil {
				pos = &position{outcomeID: b.Outcome}
				byOutcome[b.Outcome] = pos
				order = append(order, b.Outcome)
			}
			pos.staked += b.Cost   // elo spent
			pos.shares += b.Shares // shares held (each pays 1 if the outcome wins)
		}
		if len(order) > 0 {
			positions := make([]struct {
				OutcomeId string  `json:"outcome_id"`
				Shares    float64 `json:"shares"`
				Staked    float64 `json:"staked"`
			}, 0, len(order))
			for _, oid := range order {
				pos := byOutcome[oid]
				positions = append(positions, struct {
					OutcomeId string  `json:"outcome_id"`
					Shares    float64 `json:"shares"`
					Staked    float64 `json:"staked"`
				}{OutcomeId: pos.outcomeID, Shares: pos.shares, Staked: pos.staked})
			}
			detail.MyPositions = &positions
		}
	}

	if reserved, err := s.api.MarketService.GetPlayerReservedAmount(ctx, playerID); err == nil {
		detail.Reserved = &reserved
	}
	if limit, err := s.api.MarketService.GetPlayerBetLimit(ctx, playerID); err == nil {
		detail.BetLimit = &limit
	}
}

// maxMatchWinnerTargets caps the number of target players (and therefore
// outcomes) on a match_winner market — every outcome needs a chart line and a
// donut segment, so the cardinality stays displayable.
const maxMatchWinnerTargets = 12

func (s *StrictServer) CreateMarket(ctx context.Context, request CreateMarketRequestObject) (CreateMarketResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return CreateMarket401JSONResponse{Status: "fail", Message: "authentication required"}, nil
		}
		return nil, err
	}

	body := request.Body

	startsAt := time.Now()
	if body.StartsAt != nil {
		if body.StartsAt.Before(time.Now()) {
			return CreateMarket400JSONResponse{Status: "fail", Message: "starts_at не может быть в прошлом"}, nil
		}
		startsAt = *body.StartsAt
	}

	params := elo.CreateMarketParams{
		ID:         body.Id,
		MarketType: string(body.MarketType),
		StartsAt:   startsAt,
		ClosesAt:   body.ClosesAt,
		CreatedBy:  user.ID,
	}

	if body.GuarantorPlayerIds != nil {
		params.GuarantorPlayerIDs = make([]string, len(*body.GuarantorPlayerIds))
		copy(params.GuarantorPlayerIDs, *body.GuarantorPlayerIds)
	}
	if body.LiquidityB != nil {
		params.LiquidityB = *body.LiquidityB
	}

	switch string(body.MarketType) {
	case "match_winner":
		if body.TargetPlayerIds == nil || len(*body.TargetPlayerIds) == 0 {
			return CreateMarket400JSONResponse{Status: "fail", Message: "match_winner requires target_player_ids"}, nil
		}
		if len(*body.TargetPlayerIds) > maxMatchWinnerTargets {
			return CreateMarket400JSONResponse{Status: "fail", Message: "слишком много целевых игроков"}, nil
		}
		if body.AllowOtherPlayers == nil {
			return CreateMarket400JSONResponse{Status: "fail", Message: "match_winner requires allow_other_players"}, nil
		}
		// Deduplicate while preserving order.
		seen := make(map[string]bool, len(*body.TargetPlayerIds))
		targets := make([]string, 0, len(*body.TargetPlayerIds))
		for _, id := range *body.TargetPlayerIds {
			if !seen[id] {
				seen[id] = true
				targets = append(targets, id)
			}
		}
		var gameIDs []string
		if body.GameIds != nil {
			gameIDs = make([]string, len(*body.GameIds))
			copy(gameIDs, *body.GameIds)
		}
		params.MatchWinner = &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   targets,
			AllowOtherPlayers: *body.AllowOtherPlayers,
			GameIDs:           gameIDs,
		}

	case "win_streak":
		if body.TargetPlayerId == nil || *body.TargetPlayerId == "" {
			return CreateMarket400JSONResponse{Status: "fail", Message: "invalid target_player_id"}, nil
		}
		if body.WinsRequired == nil {
			return CreateMarket400JSONResponse{Status: "fail", Message: "win_streak requires wins_required"}, nil
		}
		var streakGameIDs []string
		if body.StreakGameIds != nil {
			streakGameIDs = make([]string, len(*body.StreakGameIds))
			copy(streakGameIDs, *body.StreakGameIds)
		}
		var maxLosses *int32
		if body.MaxLosses != nil {
			v := int32(*body.MaxLosses)
			maxLosses = &v
		}
		params.WinStreak = &elo.WinStreakCreateParams{
			TargetPlayerID: *body.TargetPlayerId,
			GameIDs:        streakGameIDs,
			WinsRequired:   int32(*body.WinsRequired),
			MaxLosses:      maxLosses,
		}

	default:
		return CreateMarket400JSONResponse{Status: "fail", Message: "unknown market_type: " + string(body.MarketType)}, nil
	}

	market, err := s.api.MarketService.CreateMarket(ctx, params)
	if err != nil {
		if errors.Is(err, elo.ErrMarketNeedsGuarantor) {
			return CreateMarket400JSONResponse{Status: "fail", Message: err.Error()}, nil
		}
		return nil, err
	}

	resp := CreateMarket201JSONResponse{Status: "success"}
	resp.Data.Id = market.ID
	return resp, nil
}

func (s *StrictServer) PatchMarket(ctx context.Context, request PatchMarketRequestObject) (PatchMarketResponseObject, error) {
	switch string(request.Body.Status) {
	case "betting_closed":
		if err := s.api.MarketService.LockMarketBetting(ctx, request.Id); err != nil {
			if errors.Is(err, elo.ErrMarketNotOpen) {
				return PatchMarket409JSONResponse{Status: "fail", Message: err.Error()}, nil
			}
			return nil, err
		}
		return PatchMarket200JSONResponse{Status: "success", Message: "Betting closed"}, nil
	default:
		return PatchMarket400JSONResponse{Status: "fail", Message: "unsupported status transition: " + string(request.Body.Status)}, nil
	}
}

func (s *StrictServer) DeleteMarket(ctx context.Context, request DeleteMarketRequestObject) (DeleteMarketResponseObject, error) {
	if err := s.api.MatchService.DeleteMarketAndRecalculate(ctx, request.Id); err != nil {
		if errors.Is(err, elo.ErrMarketNotOpen) {
			return DeleteMarket409JSONResponse{Status: "fail", Message: err.Error()}, nil
		}
		return nil, err
	}

	return DeleteMarket200JSONResponse{Status: "success", Message: "Market deleted"}, nil
}

func (s *StrictServer) PlaceBet(ctx context.Context, request PlaceBetRequestObject) (PlaceBetResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
		if domainStatusCode(err) == http.StatusNotFound {
			return PlaceBet401JSONResponse{Status: "fail", Message: "authentication required"}, nil
		}
		return nil, err
	}
	if user.PlayerID == nil {
		return PlaceBet403JSONResponse{Status: "fail", Message: elo.ErrPlayerHasNoLinkedPlayer.Error()}, nil
	}

	body := request.Body
	if body.Shares <= 0 {
		return PlaceBet400JSONResponse{Status: "fail", Message: "shares must be positive"}, nil
	}
	if body.ExpectedPrice <= 0 || body.ExpectedPrice >= 1 {
		return PlaceBet400JSONResponse{Status: "fail", Message: "expected_price must be in (0, 1)"}, nil
	}

	outcome, err := s.api.MarketService.PlaceBet(ctx, body.Id, request.Id, *user.PlayerID, body.OutcomeId, body.Shares, body.ExpectedPrice)
	if err != nil {
		switch {
		case errors.Is(err, elo.ErrBetLimitExceeded):
			return PlaceBet422JSONResponse{Status: "fail", Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketOutcomeNotFound):
			return PlaceBet400JSONResponse{Status: "fail", Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketNotOpen), errors.Is(err, elo.ErrPriceChanged):
			return PlaceBet409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	resp := PlaceBet201JSONResponse{Status: "success"}
	resp.Data.Shares = outcome.Shares
	resp.Data.Price = outcome.Price
	return resp, nil
}

func (s *StrictServer) GetMarketsByMatchId(ctx context.Context, request GetMarketsByMatchIdRequestObject) (GetMarketsByMatchIdResponseObject, error) {
	id := request.Id

	rows, err := s.api.MarketService.ListMarketsByResolutionMatch(ctx, &id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return GetMarketsByMatchId200JSONResponse{Status: "success", Data: []Market{}}, nil
	}

	liquidity := make(map[string]float64, len(rows))
	for _, r := range rows {
		liquidity[r.ID] = r.LiquidityB
	}
	result := make([]Market, 0, len(rows))
	for _, r := range rows {
		outcomeRows, err := s.api.MarketService.ListMarketOutcomesWithPools(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		m := buildMarket(marketRowFromByMatch(r), buildOutcomes(outcomeRows, r.LiquidityB))
		if r.Status == "resolved" {
			if details, err := s.api.MarketService.GetSettlementDetails(ctx, &r.ID); err == nil {
				m.Settlement = convertSettlement(details)
			}
			if gp, err := s.api.MarketService.GetMarketGuarantorPayouts(ctx, r.ID); err == nil {
				m.GuarantorSettlement = convertGuarantorPayouts(gp)
			}
		}
		result = append(result, m)
	}

	return GetMarketsByMatchId200JSONResponse{Status: "success", Data: result}, nil
}
