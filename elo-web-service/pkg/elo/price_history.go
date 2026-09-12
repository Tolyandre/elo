package elo

import (
	"sort"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// This file reconstructs a market's probability history by replaying its
// timeline — the ordered stream of bets and guarantee joins — through the
// LMSR. Every bet shifts the AMM state vector q by its shares on one outcome;
// every guarantee join raises b = min(L, Σrisk)/ln(n) and rescales q by
// b_new/b_old, which preserves prices (ADR-20). Replaying the merged stream
// from the creation state q=0, b=0 reproduces the probability of every outcome
// after every event. No probabilities are persisted — the series is derived
// from the immutable bets and market_guarantees rows alone.

// TimelineEventKind discriminates the replay steps.
type TimelineEventKind int

const (
	// TimelineGuarantee is a guarantor wager join: liquidity grows and q is
	// rescaled.
	TimelineGuarantee TimelineEventKind = iota
	// TimelineBet is a buy: the outcome's q component grows by the shares.
	TimelineBet
)

// TimelineEvent is one replay step: the shares bought on an outcome (bet) or
// the risk amount joined (guarantee), and when.
type TimelineEvent struct {
	Kind       TimelineEventKind
	At         time.Time
	Outcome    id.ID    // bet: the outcome bought
	Shares     float64  // bet: shares bought
	RiskAmount float64  // guarantee: risk amount joined
}

// OutcomeProbability is the probability (LMSR marginal price) of one outcome
// at a point in time.
type OutcomeProbability struct {
	OutcomeID   id.ID
	Probability float64
}

// ProbabilityPoint is the reconstructed probability vector right after an
// event: the probability of every outcome, summing to 1.
type ProbabilityPoint struct {
	PlacedAt      time.Time
	Probabilities []OutcomeProbability
}

// ProbabilityHistory replays `events` (bets and guarantees, already merged in
// deterministic order) from the creation state q=0, b=0 and returns the
// probability vector after each event. outcomeIDs fixes the vector layout (and
// its length); bets on unknown outcomes are skipped (defensive — the FK
// guarantees they reference real outcome rows of this market). Returns an
// empty slice for an event-less market.
func ProbabilityHistory(events []TimelineEvent, outcomeIDs []id.ID, maxGuarantorLoss float64) []ProbabilityPoint {
	index := make(map[id.ID]int, len(outcomeIDs))
	for i, oid := range outcomeIDs {
		index[oid] = i
	}
	q := make([]float64, len(outcomeIDs))
	b := 0.0
	totalRisk := 0.0
	points := make([]ProbabilityPoint, 0, len(events))
	for _, ev := range events {
		switch ev.Kind {
		case TimelineGuarantee:
			totalRisk += ev.RiskAmount
			newB := liquidityBForRisk(maxGuarantorLoss, totalRisk, len(outcomeIDs))
			if b > 0 && newB > 0 {
				factor := newB / b
				for i := range q {
					q[i] *= factor
				}
			}
			b = newB
		case TimelineBet:
			i, ok := index[ev.Outcome]
			if !ok || ev.Shares <= 0 {
				continue // defensive: replayed shares are always positive
			}
			q[i] += ev.Shares
		}
		probabilities := MarginalProbabilitiesN(q, b)
		pp := ProbabilityPoint{PlacedAt: ev.At, Probabilities: make([]OutcomeProbability, len(outcomeIDs))}
		for j, oid := range outcomeIDs {
			pp.Probabilities[j] = OutcomeProbability{OutcomeID: oid, Probability: probabilities[j]}
		}
		points = append(points, pp)
	}
	return points
}

// mergeTimeline merges the ordered bet and guarantee streams into one
// deterministic event order: by timestamp, with a guarantee sorting before a
// bet at the exact same time (the wager's liquidity is in effect for the bet).
func mergeTimeline(bets []PriceBet, wagers []GuaranteeWager) []TimelineEvent {
	events := make([]TimelineEvent, 0, len(bets)+len(wagers))
	for _, b := range bets {
		events = append(events, TimelineEvent{Kind: TimelineBet, At: b.PlacedAt, Outcome: b.Outcome, Shares: b.Shares})
	}
	for _, w := range wagers {
		events = append(events, TimelineEvent{Kind: TimelineGuarantee, At: w.CreatedAt, RiskAmount: w.RiskAmount})
	}
	// Stable insertion order: guarantees were appended after bets, so a stable
	// sort by (time, kind) keeps the merge deterministic.
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		if a.At.Equal(b.At) {
			return a.Kind < b.Kind // TimelineGuarantee (0) before TimelineBet (1)
		}
		return a.At.Before(b.At)
	})
	return events
}

// PriceBet is one bet-side replay input: the shares bought on an outcome and
// when.
type PriceBet struct {
	Outcome  id.ID
	Shares   float64
	PlacedAt time.Time
}
