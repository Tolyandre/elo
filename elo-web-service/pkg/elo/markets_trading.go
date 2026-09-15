package elo

import (
	"context"
	"fmt"
	"math"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ProbabilityTolerance is the maximum allowed difference between the expected
// probability the buyer saw (and sends with the bet) and the live probability
// at bet time. Covers UI rounding and SSE propagation latency, but rejects the
// buy once other participants have moved the market.
const ProbabilityTolerance = 0.01

// PlaceBetOutcome is returned to the buyer: the shares received, the effective
// elo cost paid per share (LMSR cost + maker fee, per share) and the maker fee
// part — a cost, not the outcome's probability.
type PlaceBetOutcome struct {
	Shares       float64
	CostPerShare float64
	Fee          float64
}

func (s *MarketService) PlaceBet(ctx context.Context, betID id.ID, marketID id.ID, playerID id.ID, outcome id.ID, shares float64, expectedProbability float64) (PlaceBetOutcome, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	if _, err := q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("lock player: %w", err)
	}

	// Serialize AMM mutations on the market row so a concurrent guarantee join
	// (which changes b) cannot interleave with this bet's read-compute-write.
	if err := q.LockMarket(ctx, marketID); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("lock market: %w", err)
	}

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return PlaceBetOutcome{}, ErrMarketNotOpen
	}
	// Without guarantors there is no liquidity to trade against: the b→0 limit
	// of the LMSR makes underdog shares free lottery tickets with nobody to
	// pay the winners (ADR-20), so bets are rejected outright.
	if market.LiquidityB <= 0 {
		return PlaceBetOutcome{}, ErrMarketNeedsGuarantor
	}

	// The outcome rows fix the AMM q-vector layout; the bet's outcome must be
	// one of them.
	outcomes, err := q.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("list market outcomes: %w", err)
	}
	outcomeIdx := -1
	qVec := make([]float64, len(outcomes))
	for i, o := range outcomes {
		qVec[i] = o.Q
		if o.ID == outcome {
			outcomeIdx = i
		}
	}
	if outcomeIdx < 0 {
		return PlaceBetOutcome{}, ErrMarketOutcomeNotFound
	}

	// The buyer must confirm the probability they saw: reject if the live
	// probability of the outcome has drifted away beyond ProbabilityTolerance
	// since the client loaded it.
	currentProbability := MarginalProbabilitiesN(qVec, market.LiquidityB)[outcomeIdx]
	if math.Abs(currentProbability-expectedProbability) > ProbabilityTolerance {
		return PlaceBetOutcome{}, ErrProbabilityChanged
	}

	// A guarantor may also buy on their own market: at settlement they get
	// separate buyer and guarantor rows (ADR-10).

	// Shares-driven buy per ADR-10: the buyer asks for `shares` tokens (the UI
	// always buys 1) and pays the AMM cost amount = C(q+shares·e_i) − C(q)
	// plus the variance-proportional maker fee of the guarantors (ADR-20).
	// `amount + fee` is what is reserved against the buyer's bet_limit.
	wagers, err := q.ListMarketGuaranteeWagers(ctx, marketID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("list guarantee wagers: %w", err)
	}
	feeRate := MarketFeeRate(guaranteeWagersFromDB(wagers))
	newQ, amount := ApplyBetN(qVec, market.LiquidityB, outcomeIdx, shares)
	fee := BuyFeeN(qVec, market.LiquidityB, outcomeIdx, shares, feeRate)

	reserved, err := q.GetPlayerReservedAmount(ctx, playerID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get reserved amount: %w", err)
	}
	limit, err := q.GetPlayerBetLimit(ctx, playerID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get bet limit: %w", err)
	}
	if reserved+amount+fee > limit {
		return PlaceBetOutcome{}, ErrBetLimitExceeded
	}

	if _, err := q.InsertBet(ctx, db.InsertBetParams{
		ID:       betID,
		MarketID: marketID,
		PlayerID: playerID,
		Outcome:  outcome,
		Cost:     amount,
		Fee:      fee,
		Shares:   shares,
	}); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("insert bet: %w", err)
	}

	if err := q.UpdateMarketOutcomeQ(ctx, db.UpdateMarketOutcomeQParams{
		MarketID: marketID,
		ID:       outcome,
		Q:        newQ[outcomeIdx],
	}); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("update amm state: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("commit tx: %w", err)
	}

	if s.Hub != nil {
		live := make([]LiveOutcome, len(outcomes))
		probabilities := MarginalProbabilitiesN(newQ, market.LiquidityB)
		for i, o := range outcomes {
			pool := o.Pool
			if i == outcomeIdx {
				pool += amount + fee
			}
			// SSE frames bypass the JSON DTO layer, so the wire-form encoding
			// is applied here, at construction (ADR-12).
			live[i] = LiveOutcome{ID: string(o.ID.Base58()), Probability: probabilities[i], Shares: newQ[i], Pool: pool}
		}
		s.broadcastProbabilities(marketID, live)
	}

	costPerShare := 0.0
	if shares > 0 {
		costPerShare = (amount + fee) / shares
	}
	return PlaceBetOutcome{Shares: shares, CostPerShare: costPerShare, Fee: fee}, nil
}

// GuaranteeOutcome is returned when a player becomes a guarantor.
type GuaranteeOutcome struct {
	RiskAmount       float64
	FeeRate          float64
	LiquidityB       float64
	TotalRisk        float64
	MaxGuarantorLoss float64
}

// maxGuaranteeFeeRate caps each guarantor's maker fee: with c ≤ 0.25 the
// fee-inclusive marginal price p_u = p + 4c·p(1−p) never exceeds 1 (ADR-20).
const maxGuaranteeFeeRate = 0.25

// JoinAsGuarantee adds the player's voluntary guarantor wager to an open
// market: the risk amount (their maximum loss) is reserved against the betting
// limit, and the market's liquidity grows to b = min(L, Σrisk)/ln(n) — capped
// by L even when wagers over-subscribe it, with all earnings and losses staying
// proportional to the risked amounts. b rises over a fixed q, so prices move
// toward the uniform 1/n vector (the market deepens; ADR-22) — scaling q with
// b would preserve prices but detach the AMM's cost function from the
// unscaled, real collected elo and bet shares, letting post-join buys amass
// payouts far beyond the guarantors' risk. Wagers are immutable.
func (s *MarketService) JoinAsGuarantee(ctx context.Context, guaranteeID id.ID, marketID id.ID, playerID id.ID, riskAmount, feeRate float64) (GuaranteeOutcome, error) {
	if riskAmount <= 0 {
		return GuaranteeOutcome{}, ErrGuaranteeRiskNotPositive
	}
	if feeRate < 0 || feeRate > maxGuaranteeFeeRate {
		return GuaranteeOutcome{}, ErrGuaranteeFeeOutOfRange
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	if _, err := q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("lock player: %w", err)
	}
	if err := q.LockMarket(ctx, marketID); err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("lock market: %w", err)
	}

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return GuaranteeOutcome{}, ErrMarketNotOpen
	}

	wagers, err := q.ListMarketGuaranteeWagers(ctx, marketID)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("list guarantee wagers: %w", err)
	}
	totalRisk := riskAmount
	for _, w := range wagers {
		totalRisk += w.RiskAmount
	}

	// Guarantor exposure is reserved against the betting limit (ADR-20).
	reserved, err := q.GetPlayerReservedAmount(ctx, playerID)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("get reserved amount: %w", err)
	}
	limit, err := q.GetPlayerBetLimit(ctx, playerID)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("get bet limit: %w", err)
	}
	if reserved+riskAmount > limit {
		return GuaranteeOutcome{}, ErrBetLimitExceeded
	}

	outcomes, err := q.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("list market outcomes: %w", err)
	}
	newB := liquidityBForRisk(market.MaxGuarantorLoss, totalRisk, len(outcomes))

	// Liquidity injection with q fixed: the probabilities move toward the
	// uniform 1/n vector (ADR-22). q must never be scaled along with b —
	// the stored bets' shares and costs are real and unscaled, so a scaled
	// q would price post-join buys against backing that does not exist.
	if err := q.UpdateMarketLiquidityB(ctx, db.UpdateMarketLiquidityBParams{
		ID:         marketID,
		LiquidityB: newB,
	}); err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("update liquidity: %w", err)
	}

	if _, err := q.InsertMarketGuarantee(ctx, db.InsertMarketGuaranteeParams{
		ID:         guaranteeID,
		MarketID:   marketID,
		PlayerID:   playerID,
		RiskAmount: riskAmount,
		FeeRate:    feeRate,
	}); err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("insert guarantee: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return GuaranteeOutcome{}, fmt.Errorf("commit tx: %w", err)
	}

	if s.Hub != nil {
		// The join repriced the market (b rose over a fixed q, ADR-22): push
		// the new probabilities so open market pages update without a refetch.
		qVec := make([]float64, len(outcomes))
		for i, o := range outcomes {
			qVec[i] = o.Q
		}
		probabilities := MarginalProbabilitiesN(qVec, newB)
		live := make([]LiveOutcome, len(outcomes))
		for i, o := range outcomes {
			// SSE frames bypass the JSON DTO layer, so the wire-form encoding
			// is applied here, at construction (ADR-12).
			live[i] = LiveOutcome{ID: string(o.ID.Base58()), Probability: probabilities[i], Shares: o.Q, Pool: o.Pool}
		}
		s.broadcastProbabilities(marketID, live)
		s.Hub.PublishSignal(MarketTopic(marketID), "guarantees-changed")
	}

	return GuaranteeOutcome{
		RiskAmount:       riskAmount,
		FeeRate:          feeRate,
		LiquidityB:       newB,
		TotalRisk:        totalRisk,
		MaxGuarantorLoss: market.MaxGuarantorLoss,
	}, nil
}

// guaranteeWagersFromDB projects the wager rows onto the settlement type.
func guaranteeWagersFromDB(rows []db.ListMarketGuaranteeWagersRow) []GuaranteeWager {
	wagers := make([]GuaranteeWager, len(rows))
	for i, r := range rows {
		wagers[i] = GuaranteeWager{
			ID:         r.ID,
			PlayerID:   r.PlayerID,
			RiskAmount: r.RiskAmount,
			FeeRate:    r.FeeRate,
			CreatedAt:  r.CreatedAt,
		}
	}
	return wagers
}
