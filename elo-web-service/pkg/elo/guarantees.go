package elo

import (
	"math"
	"sort"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Guarantor economics (ADR-20). Guarantors are voluntary liquidity providers:
// each guarantee is an immutable wager of {risk amount, maker fee rate}. The
// market's maker fee c is the risk-weighted mean of the wager fee rates; buys
// pay the variance-proportional surcharge (amm.go). At settlement the guarantors
// receive two pots:
//
//   - the fee pool: every charged fee, attributed time-windowed — each bet's
//     fee is shared only among wagers placed no later than the bet, weighted
//     fee·risk, so a late joiner cannot free-ride on earlier fees;
//   - the equity residual (collected − paid, fees excluded): a surplus is
//     split pro-rata by risk; a deficit is covered by the first-loss waterfall
//     — fee-charging wagers pay first (weighted fee·risk, capped at their
//     risk), everyone else backs them up pro-rata by risk. Zero-fee guarantors
//     are therefore the senior tranche.
//
// Every distribution is a pure function of the immutable bet and wager rows, so
// settlement stays replay-safe (unsettle → re-settle is byte-identical), and
// each split assigns the floating-point remainder deterministically so the
// per-wager results sum to the pot exactly (strict zero-sum conservation).

// GuaranteeWager is the projection of one market_guarantees row.
type GuaranteeWager struct {
	ID         id.ID
	PlayerID   id.ID
	RiskAmount float64
	FeeRate    float64
	CreatedAt  time.Time
}

// betRecord is what settlement needs to know about one buy.
type betRecord struct {
	PlayerID id.ID
	Outcome  id.ID
	Cost     float64
	Fee      float64
	Shares   float64
	PlacedAt time.Time
}

// MarketFeeRate returns the market's current maker fee c: the risk-weighted
// mean of the wager fee rates. Each rate is capped at 0.25 by the schema, so
// the mean is too.
func MarketFeeRate(wagers []GuaranteeWager) float64 {
	var weighted, risk float64
	for _, w := range wagers {
		weighted += w.FeeRate * w.RiskAmount
		risk += w.RiskAmount
	}
	if risk <= 0 {
		return 0
	}
	return weighted / risk
}

// liquidityBForRisk maps the total guarantor risk to the LMSR liquidity
// parameter: b = min(maxLoss, totalRisk)/ln(n). The min keeps each guarantor's
// maximum loss at their risked amount (the combined worst case is b·ln(n)).
func liquidityBForRisk(maxLoss, totalRisk float64, outcomeCount int) float64 {
	if outcomeCount < 2 || totalRisk <= 0 {
		return 0
	}
	effective := totalRisk
	if maxLoss < effective {
		effective = maxLoss
	}
	return effective / math.Log(float64(outcomeCount))
}

// settleGuarantors computes the per-player guarantor net result (positive =
// earned, negative = staked) from the bet stream and wagers. residual is the
// equity residual (collected − paid, fees excluded). The returned shares sum to
// residual + feePool exactly. Empty wagers yield nil (callers skip guarantor
// rows entirely — possible only for bet-less markets).
func settleGuarantors(bets []betRecord, wagers []GuaranteeWager, residual float64) map[id.ID]float64 {
	if len(wagers) == 0 {
		return nil
	}

	// Deterministic wager order (matches the SQL ORDER BY created_at, id).
	ordered := append([]GuaranteeWager(nil), wagers...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].CreatedAt.Before(ordered[j].CreatedAt)
	})

	perWager := make([]float64, len(ordered))
	risk := make([]float64, len(ordered))
	feeWeight := make([]float64, len(ordered))
	for i, w := range ordered {
		risk[i] = w.RiskAmount
		feeWeight[i] = w.FeeRate * w.RiskAmount
	}

	// Fee pool, attributed time-windowed per bet.
	for _, b := range bets {
		if b.Fee <= 0 {
			continue
		}
		weights := activeFeeWeights(ordered, feeWeight, b.PlacedAt)
		allocate(b.Fee, weights, perWager)
	}

	// Equity residual: pro-rata surplus or first-loss waterfall deficit.
	if residual >= 0 {
		allocate(residual, risk, perWager)
	} else {
		deficit := -residual
		// Tier 1: fee-charging wagers, weighted fee·risk, capped at their risk.
		tier1 := make([]float64, len(ordered))
		for i, w := range ordered {
			if w.FeeRate > 0 {
				tier1[i] = feeWeight[i]
			}
		}
		paid := cappedProportional(deficit, tier1, risk)
		for i, p := range paid {
			perWager[i] -= p
			deficit -= p
		}
		if deficit > 0 {
			// Tier 2: everyone with remaining capacity, weighted by risk.
			capacity := make([]float64, len(ordered))
			for i, p := range paid {
				capacity[i] = risk[i] - p
			}
			tier2 := cappedProportional(deficit, risk, capacity)
			for i, p := range tier2 {
				perWager[i] -= p
			}
		}
	}

	shares := make(map[id.ID]float64, len(ordered))
	for i, w := range ordered {
		shares[w.PlayerID] += perWager[i]
	}
	return shares
}

// activeFeeWeights returns the fee·risk weights of the wagers active for a bet
// (placed no later than the bet). Falls back to all wagers when the window is
// empty or has zero weight — possible only through a timestamp inversion of
// concurrently committed rows; the fallback keeps the fee fully attributed
// (zero-sum) and stays a pure function of the stored rows.
func activeFeeWeights(ordered []GuaranteeWager, feeWeight []float64, placedAt time.Time) []float64 {
	active := make([]float64, len(ordered))
	var sum float64
	for i, w := range ordered {
		if !w.CreatedAt.After(placedAt) {
			active[i] = feeWeight[i]
			sum += feeWeight[i]
		}
	}
	if sum > 0 {
		return active
	}
	return feeWeight
}

// allocate splits `total` across wagers proportionally to `weights`, adding to
// `acc` and assigning the FP remainder to the last weighted wager so the split
// sums to total exactly. Zero-weight wagers receive nothing.
func allocate(total float64, weights, acc []float64) {
	if total == 0 {
		return
	}
	var sum float64
	last := -1
	for i, w := range weights {
		if w > 0 {
			sum += w
			last = i
		}
	}
	if sum <= 0 || last < 0 {
		return
	}
	var assigned float64
	for i, w := range weights {
		if w > 0 && i != last {
			share := total * w / sum
			acc[i] += share
			assigned += share
		}
	}
	acc[last] += total - assigned
}

// cappedProportional splits `total` across wagers proportionally to `weights`,
// never exceeding the per-wager `caps` — classic water-filling: wagers whose
// proportional share exceeds their cap are fixed at the cap and the remainder
// is redistributed among the rest. The final pass assigns the exact remainder
// to the last open wager so allocations sum to total. Returns per-wager
// allocations (all zero for non-positive total).
func cappedProportional(total float64, weights, caps []float64) []float64 {
	alloc := make([]float64, len(weights))
	if total <= 0 {
		return alloc
	}
	// All-zero weights allocate nothing — the caller decides the fallback
	// (e.g. the waterfall's senior tier), so parking the total here would
	// bypass it.
	open := make([]bool, len(weights))
	anyWeighted := false
	for i := range weights {
		if weights[i] > 0 && caps[i] > 0 {
			open[i] = true
			anyWeighted = true
		}
	}
	if !anyWeighted {
		return alloc
	}
	for {
		var wsum float64
		last := -1
		for i := range weights {
			if open[i] {
				wsum += weights[i]
				last = i
			}
		}
		if wsum <= 0 || last < 0 {
			break
		}
		if !anyOverCap(total, wsum, weights, caps, open) {
			var assigned float64
			for i := range weights {
				if open[i] && i != last {
					share := total * weights[i] / wsum
					alloc[i] += share
					assigned += share
				}
			}
			alloc[last] += total - assigned
			if alloc[last] < 0 {
				alloc[last] = 0
			}
			return alloc
		}
		// Fix every over-cap wager at its cap and continue with the remainder.
		for i := range weights {
			if open[i] && total*weights[i]/wsum > caps[i]+1e-9 {
				alloc[i] += caps[i]
				total -= caps[i]
				open[i] = false
			}
		}
	}
	if total > 1e-9 {
		// FP dust beyond all caps (mathematically impossible: caps always
		// cover the deficit). Park it on the largest cap so the sum stays
		// exact.
		best := 0
		for i := range caps {
			if caps[i] > caps[best] {
				best = i
			}
		}
		alloc[best] += total
	} else if total < 0 {
		// Over-allocated by FP dust after capping: trim the last filled wager.
		for i := len(alloc) - 1; i >= 0; i-- {
			if alloc[i] > 0 {
				alloc[i] += total
				if alloc[i] < 0 {
					alloc[i] = 0
				}
				break
			}
		}
	}
	return alloc
}

func anyOverCap(total, wsum float64, weights, caps []float64, open []bool) bool {
	for i := range weights {
		if open[i] && total*weights[i]/wsum > caps[i]+1e-9 {
			return true
		}
	}
	return false
}
