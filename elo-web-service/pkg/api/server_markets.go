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

// buildTypedParams converts raw DB columns to the typed params union. It is
// generic over the two generated response shapes (Market_Params and
// MarketDetail_Params), which previously had two identical copy-pasted builders.
// A fresh T is allocated and its address (P) is returned; FromMatchWinnerParams
// and FromWinStreakParams have pointer receivers and dereference the receiver,
// so a nil pointer would panic — a previous version used `var p P` and crashed
// at runtime on GET /markets.
func buildTypedParams[T marketParams, P paramsFiller[T]](marketType string, targetPlayerID string, requiredPlayerIds []string, mwGameIDs []string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, P) {
	p := P(new(T))
	switch marketType {
	case "match_winner":
		gameIDStrs := mwGameIDs
		_ = p.FromMatchWinnerParams(MatchWinnerParams{RequiredPlayerIds: requiredPlayerIds, GameIds: &gameIDStrs})
	case "win_streak":
		var maxL *int
		if maxLosses.Valid {
			v := int(maxLosses.Int32)
			maxL = &v
		}
		_ = p.FromWinStreakParams(WinStreakParams{
			GameIds:      wsGameIDs,
			WinsRequired: int(winsRequired.Int32),
			MaxLosses:    maxL,
		})
	default:
		return targetPlayerID, nil
	}
	return targetPlayerID, p
}

// buildTypedMarketParams converts raw DB columns to the typed Market_Params union.
func buildTypedMarketParams(marketType string, targetPlayerID string, requiredPlayerIds []string, mwGameIDs []string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, *Market_Params) {
	return buildTypedParams[Market_Params, *Market_Params](marketType, targetPlayerID, requiredPlayerIds, mwGameIDs, wsGameIDs, winsRequired, maxLosses)
}

// buildTypedMarketDetailParams same as above but for MarketDetail_Params.
func buildTypedMarketDetailParams(marketType string, targetPlayerID string, requiredPlayerIds []string, mwGameIDs []string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, *MarketDetail_Params) {
	return buildTypedParams[MarketDetail_Params, *MarketDetail_Params](marketType, targetPlayerID, requiredPlayerIds, mwGameIDs, wsGameIDs, winsRequired, maxLosses)
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

func (s *StrictServer) ListMarkets(ctx context.Context, _ ListMarketsRequestObject) (ListMarketsResponseObject, error) {
	rows, err := s.api.MarketService.ListMarketsWithPools(ctx)
	if err != nil {
		return nil, err
	}

	active := make([]Market, 0)
	closed := make([]Market, 0)

	for _, r := range rows {
		totalPool := r.YesPool + r.NoPool
		targetID, params := buildTypedMarketParams(r.MarketType, r.TargetPlayerID, r.RequiredPlayerIds, r.MwGameIds, r.WsGameIds, r.WinsRequired, r.MaxLosses)

		m := Market{
			Id:             r.ID,
			MarketType:     MarketMarketType(r.MarketType),
			Status:         MarketStatus(r.Status),
			YesPool:        r.YesPool,
			NoPool:         r.NoPool,
			YesCoefficient: calcCoefficient(r.YesPool, totalPool),
			NoCoefficient:  calcCoefficient(r.NoPool, totalPool),
			TargetPlayerId: targetID,
			Params:         params,
		}
		applyMarketTimes(&m, r.StartsAt, r.ClosesAt, r.CreatedAt, r.ResolvedAt, r.BettingClosedAt, r.ResolutionOutcome)

		if r.Status == "open" || r.Status == "betting_closed" {
			active = append(active, m)
		} else {
			if r.Status == "resolved" {
				if details, err := s.api.MarketService.GetSettlementDetails(ctx, &r.ID); err == nil {
					m.Settlement = convertSettlement(details)
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

	row, err := s.api.MarketService.GetMarketWithPools(ctx, marketID)
	if err != nil {
		return GetMarket404JSONResponse{Status: "fail", Message: "market not found"}, nil
	}

	if (row.Status == "open" || row.Status == "betting_closed") && row.ClosesAt.Valid && row.ClosesAt.Time.Before(time.Now()) {
		_ = s.api.MarketService.ExpireOverdueMarkets(ctx)
		row, err = s.api.MarketService.GetMarketWithPools(ctx, marketID)
		if err != nil {
			return nil, err
		}
	}

	totalPool := row.YesPool + row.NoPool
	targetID, params := buildTypedMarketDetailParams(row.MarketType, row.TargetPlayerID, row.RequiredPlayerIds, row.MwGameIds, row.WsGameIds, row.WinsRequired, row.MaxLosses)

	detail := MarketDetail{
		Id:             row.ID,
		MarketType:     MarketDetailMarketType(row.MarketType),
		Status:         MarketDetailStatus(row.Status),
		YesPool:        row.YesPool,
		NoPool:         row.NoPool,
		YesCoefficient: calcCoefficient(row.YesPool, totalPool),
		NoCoefficient:  calcCoefficient(row.NoPool, totalPool),
		TargetPlayerId: targetID,
		Params:         params,
	}
	applyMarketDetailTimes(&detail, row.StartsAt, row.ClosesAt, row.CreatedAt, row.ResolvedAt, row.BettingClosedAt)
	if row.ResolutionOutcome.Valid {
		v := row.ResolutionOutcome.String
		detail.ResolutionOutcome = &v
	}
	if row.Status == "resolved" {
		if details, err := s.api.MarketService.GetSettlementDetails(ctx, &marketID); err == nil {
			detail.Settlement = convertSettlement(details)
		}
	}

	s.enrichMarketDetailForPlayer(ctx, &detail, marketID, totalPool, row.YesPool, row.NoPool)

	return GetMarket200JSONResponse{Status: "success", Data: detail}, nil
}

// enrichMarketDetailForPlayer fills the per-player projection fields (staked,
// projected reward, reserved, bet limit) when the caller is authenticated with
// a linked player. Failures of the individual reads are non-fatal: a missing
// field simply stays nil, matching the prior inline behavior.
func (s *StrictServer) enrichMarketDetailForPlayer(ctx context.Context, detail *MarketDetail, marketID string, totalPool, yesPool, noPool float64) {
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

	myBets, err := s.api.MarketService.GetPlayerBetsAggregatedForMarket(ctx, db.GetPlayerBetsAggregatedForMarketParams{
		MarketID: marketID,
		PlayerID: playerID,
	})
	if err == nil {
		var myYes, myNo float64
		for _, b := range myBets {
			if b.Outcome == "yes" {
				myYes = b.TotalAmount
			} else {
				myNo = b.TotalAmount
			}
		}
		detail.MyYesStaked = &myYes
		detail.MyNoStaked = &myNo

		var projYes, projNo float64
		if yesPool > 0 {
			projYes = (myYes / yesPool) * totalPool
		}
		if noPool > 0 {
			projNo = (myNo / noPool) * totalPool
		}
		detail.ProjectedYesReward = &projYes
		detail.ProjectedNoReward = &projNo
	}

	if reserved, err := s.api.MarketService.GetPlayerReservedAmount(ctx, playerID); err == nil {
		detail.Reserved = &reserved
	}
	if limit, err := s.api.MarketService.GetPlayerBetLimit(ctx, playerID); err == nil {
		detail.BetLimit = &limit
	}
}

// applyMarketTimes copies the optional timestamp/outcome columns onto a Market,
// niling out any that are NULL. Mirrors applyMarketDetailTimes for the list-shape
// Market type; the same field set was previously duplicated in ListMarkets and
// GetMarketsByMatchId.
func applyMarketTimes(m *Market, startsAt, closesAt, createdAt, resolvedAt, bettingClosedAt pgtype.Timestamptz, resolutionOutcome pgtype.Text) {
	if startsAt.Valid {
		t := startsAt.Time
		m.StartsAt = &t
	}
	if closesAt.Valid {
		t := closesAt.Time
		m.ClosesAt = &t
	}
	if createdAt.Valid {
		t := createdAt.Time
		m.CreatedAt = &t
	}
	if resolvedAt.Valid {
		t := resolvedAt.Time
		m.ResolvedAt = &t
	}
	if bettingClosedAt.Valid {
		t := bettingClosedAt.Time
		m.BettingClosedAt = &t
	}
	if resolutionOutcome.Valid {
		v := resolutionOutcome.String
		m.ResolutionOutcome = &v
	}
}

// applyMarketDetailTimes copies the optional timestamp columns from the row onto
// the MarketDetail, niling out any that are NULL. Centralized here because the
// same 6-field pattern was repeated across ListMarkets, GetMarket, and
// GetMarketsByMatchId.
func applyMarketDetailTimes(d *MarketDetail, startsAt, closesAt, createdAt, resolvedAt, bettingClosedAt pgtype.Timestamptz) {
	if startsAt.Valid {
		t := startsAt.Time
		d.StartsAt = &t
	}
	if closesAt.Valid {
		t := closesAt.Time
		d.ClosesAt = &t
	}
	if createdAt.Valid {
		t := createdAt.Time
		d.CreatedAt = &t
	}
	if resolvedAt.Valid {
		t := resolvedAt.Time
		d.ResolvedAt = &t
	}
	if bettingClosedAt.Valid {
		t := bettingClosedAt.Time
		d.BettingClosedAt = &t
	}
}

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

	if body.TargetPlayerId == "" {
		return CreateMarket400JSONResponse{Status: "fail", Message: "invalid target_player_id"}, nil
	}

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

	switch string(body.MarketType) {
	case "match_winner":
		var requiredIDs []string
		if body.RequiredPlayerIds != nil {
			requiredIDs = make([]string, len(*body.RequiredPlayerIds))
			copy(requiredIDs, *body.RequiredPlayerIds)
		}
		var gameIDs []string
		if body.GameIds != nil {
			gameIDs = make([]string, len(*body.GameIds))
			copy(gameIDs, *body.GameIds)
		}
		params.MatchWinner = &elo.MatchWinnerCreateParams{
			TargetPlayerID:    body.TargetPlayerId,
			RequiredPlayerIDs: requiredIDs,
			GameIDs:           gameIDs,
		}

	case "win_streak":
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
			TargetPlayerID: body.TargetPlayerId,
			GameIDs:        streakGameIDs,
			WinsRequired:   int32(*body.WinsRequired),
			MaxLosses:      maxLosses,
		}

	default:
		return CreateMarket400JSONResponse{Status: "fail", Message: "unknown market_type: " + string(body.MarketType)}, nil
	}

	market, err := s.api.MarketService.CreateMarket(ctx, params)
	if err != nil {
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
	if body.Amount <= 0 {
		return PlaceBet400JSONResponse{Status: "fail", Message: "amount must be positive"}, nil
	}

	if err := s.api.MarketService.PlaceBet(ctx, body.Id, request.Id, *user.PlayerID, string(body.Outcome), body.Amount); err != nil {
		switch {
		case errors.Is(err, elo.ErrBetLimitExceeded):
			return PlaceBet422JSONResponse{Status: "fail", Message: err.Error()}, nil
		case errors.Is(err, elo.ErrMarketNotOpen):
			return PlaceBet409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	return PlaceBet201JSONResponse{Status: "success", Message: "Bet placed"}, nil
}

func (s *StrictServer) GetMarketsByMatchId(ctx context.Context, request GetMarketsByMatchIdRequestObject) (GetMarketsByMatchIdResponseObject, error) {
	id := request.Id

	rows, err := s.api.MarketService.ListMarketsByResolutionMatch(ctx, &id)
	if err != nil {
		return nil, err
	}

	result := make([]Market, 0, len(rows))
	for _, r := range rows {
		totalPool := r.YesPool + r.NoPool
		targetID, params := buildTypedMarketParams(r.MarketType, r.TargetPlayerID, r.RequiredPlayerIds, r.MwGameIds, r.WsGameIds, r.WinsRequired, r.MaxLosses)

		m := Market{
			Id:             r.ID,
			MarketType:     MarketMarketType(r.MarketType),
			Status:         MarketStatus(r.Status),
			YesPool:        r.YesPool,
			NoPool:         r.NoPool,
			YesCoefficient: calcCoefficient(r.YesPool, totalPool),
			NoCoefficient:  calcCoefficient(r.NoPool, totalPool),
			TargetPlayerId: targetID,
			Params:         params,
		}
		applyMarketTimes(&m, r.StartsAt, r.ClosesAt, r.CreatedAt, r.ResolvedAt, r.BettingClosedAt, r.ResolutionOutcome)
		if r.Status == "resolved" {
			if details, err := s.api.MarketService.GetSettlementDetails(ctx, &r.ID); err == nil {
				m.Settlement = convertSettlement(details)
			}
		}
		result = append(result, m)
	}

	return GetMarketsByMatchId200JSONResponse{Status: "success", Data: result}, nil
}
