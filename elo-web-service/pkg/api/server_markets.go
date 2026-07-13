package api

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

// buildTypedMarketParams converts raw DB columns to the typed Market_Params union.
func buildTypedMarketParams(marketType string, targetPlayerID string, requiredPlayerIds []string, mwGameIDs []string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, *Market_Params) {
	switch marketType {
	case "match_winner":
		gameIDStrs := mwGameIDs
		p := &Market_Params{}
		_ = p.FromMatchWinnerParams(MatchWinnerParams{RequiredPlayerIds: requiredPlayerIds, GameIds: &gameIDStrs})
		return targetPlayerID, p
	case "win_streak":
		var maxL *int
		if maxLosses.Valid {
			v := int(maxLosses.Int32)
			maxL = &v
		}
		p := &Market_Params{}
		_ = p.FromWinStreakParams(WinStreakParams{
			GameIds:      wsGameIDs,
			WinsRequired: int(winsRequired.Int32),
			MaxLosses:    maxL,
		})
		return targetPlayerID, p
	}
	return targetPlayerID, nil
}

// buildTypedMarketDetailParams same as above but for MarketDetail_Params.
func buildTypedMarketDetailParams(marketType string, targetPlayerID string, requiredPlayerIds []string, mwGameIDs []string, wsGameIDs []string, winsRequired pgtype.Int4, maxLosses pgtype.Int4) (string, *MarketDetail_Params) {
	switch marketType {
	case "match_winner":
		gameIDStrs := mwGameIDs
		p := &MarketDetail_Params{}
		_ = p.FromMatchWinnerParams(MatchWinnerParams{RequiredPlayerIds: requiredPlayerIds, GameIds: &gameIDStrs})
		return targetPlayerID, p
	case "win_streak":
		var maxL *int
		if maxLosses.Valid {
			v := int(maxLosses.Int32)
			maxL = &v
		}
		p := &MarketDetail_Params{}
		_ = p.FromWinStreakParams(WinStreakParams{
			GameIds:      wsGameIDs,
			WinsRequired: int(winsRequired.Int32),
			MaxLosses:    maxL,
		})
		return targetPlayerID, p
	}
	return targetPlayerID, nil
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
	rows, err := s.api.Queries.ListMarketsWithPools(ctx)
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
		if r.ResolutionOutcome.Valid {
			v := r.ResolutionOutcome.String
			m.ResolutionOutcome = &v
		}

		if r.Status == "open" || r.Status == "betting_closed" {
			active = append(active, m)
		} else {
			if r.Status == "resolved" {
				if details, err := s.api.Queries.GetSettlementDetails(ctx, &r.ID); err == nil {
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

	row, err := s.api.Queries.GetMarketWithPools(ctx, marketID)
	if err != nil {
		return GetMarket404JSONResponse{Status: "fail", Message: "market not found"}, nil
	}

	if (row.Status == "open" || row.Status == "betting_closed") && row.ClosesAt.Valid && row.ClosesAt.Time.Before(time.Now()) {
		_ = s.api.MarketService.ExpireOverdueMarkets(ctx)
		row, err = s.api.Queries.GetMarketWithPools(ctx, marketID)
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
	if row.ResolutionOutcome.Valid {
		v := row.ResolutionOutcome.String
		detail.ResolutionOutcome = &v
	}
	if row.Status == "resolved" {
		if details, err := s.api.Queries.GetSettlementDetails(ctx, &marketID); err == nil {
			detail.Settlement = convertSettlement(details)
		}
	}

	// Per-player fields when authenticated
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx != nil {
		userID, hasUser := tryGetCurrentUserID(ginCtx)
		if hasUser {
			user, err := s.api.UserService.GetUserByID(ctx, userID)
			if err == nil && user.PlayerID != nil {
				playerID := *user.PlayerID

				myBets, err := s.api.Queries.GetPlayerBetsAggregatedForMarket(ctx, db.GetPlayerBetsAggregatedForMarketParams{
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
					if row.YesPool > 0 {
						projYes = (myYes / row.YesPool) * totalPool
					}
					if row.NoPool > 0 {
						projNo = (myNo / row.NoPool) * totalPool
					}
					detail.ProjectedYesReward = &projYes
					detail.ProjectedNoReward = &projNo
				}

				reserved, err := s.api.Queries.GetPlayerReservedAmount(ctx, playerID)
				if err == nil {
					detail.Reserved = &reserved
				}
				limit, err := s.api.Queries.GetPlayerBetLimit(ctx, playerID)
				if err == nil {
					detail.BetLimit = &limit
				}
			}
		}
	}

	return GetMarket200JSONResponse{Status: "success", Data: detail}, nil
}

func (s *StrictServer) CreateMarket(ctx context.Context, request CreateMarketRequestObject) (CreateMarketResponseObject, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("gin context not available")
	}

	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil {
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
			if err == elo.ErrMarketNotOpen {
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
		if err == elo.ErrMarketNotOpen {
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
		return nil, err
	}
	if user.PlayerID == nil {
		return PlaceBet403JSONResponse{Status: "fail", Message: "у вас нет привязанного игрока"}, nil
	}

	body := request.Body
	if body.Amount <= 0 {
		return PlaceBet400JSONResponse{Status: "fail", Message: "amount must be positive"}, nil
	}

	if err := s.api.MarketService.PlaceBet(ctx, body.Id, request.Id, *user.PlayerID, string(body.Outcome), body.Amount); err != nil {
		switch err {
		case elo.ErrBetLimitExceeded:
			return PlaceBet422JSONResponse{Status: "fail", Message: err.Error()}, nil
		case elo.ErrMarketNotOpen:
			return PlaceBet409JSONResponse{Status: "fail", Message: err.Error()}, nil
		default:
			return nil, err
		}
	}

	return PlaceBet201JSONResponse{Status: "success", Message: "Bet placed"}, nil
}

func (s *StrictServer) GetMarketsByMatchId(ctx context.Context, request GetMarketsByMatchIdRequestObject) (GetMarketsByMatchIdResponseObject, error) {
	id := request.Id

	rows, err := s.api.Queries.ListMarketsByResolutionMatch(ctx, &id)
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
		if r.ResolutionOutcome.Valid {
			v := r.ResolutionOutcome.String
			m.ResolutionOutcome = &v
		}
		if r.Status == "resolved" {
			if details, err := s.api.Queries.GetSettlementDetails(ctx, &r.ID); err == nil {
				m.Settlement = convertSettlement(details)
			}
		}
		result = append(result, m)
	}

	return GetMarketsByMatchId200JSONResponse{Status: "success", Data: result}, nil
}
