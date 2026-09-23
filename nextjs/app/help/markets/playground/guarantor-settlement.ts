// Guarantor economics for the help-page market playground — a faithful TS
// port of the server's elo-web-service/pkg/elo/guarantees.go (ADR-20, surplus
// split revised in ADR-23), so the playground's settlement numbers are the
// real algorithm. The only modeling change: the server orders events by
// (created_at, id) timestamps, the playground has a single monotonic `seq`
// counter over bets and guarantee joins — the weights are sequence-only
// anyway (ADR-23), so both produce identical splits for identical sequences.
//
// Guarantors are voluntary liquidity providers: each guarantee is an immutable
// wager of {risk amount, maker fee rate}. The market's maker fee c is the
// risk-weighted mean of the wager fee rates; buys pay the variance-proportional
// surcharge (see @/app/markets/lmsr). At settlement the guarantors receive two
// pots:
//
//  - the fee pool: every charged fee, attributed time-windowed — each bet's
//    fee is shared only among wagers placed no later than the bet, weighted
//    fee·risk, so a late joiner cannot free-ride on earlier fees;
//  - the equity residual (collected − paid, fees excluded): a surplus is
//    split by exposure accrual (ADR-23) — replaying the bet stream, every
//    wager active at a bet accrues the house's live worst-case liability
//    V = max(max_i Q_i − collected, standbyRate·envelope) times its risk
//    share; a deficit is covered by the first-loss waterfall — fee-charging
//    wagers pay first (weighted fee·risk, capped at their risk), everyone
//    else backs them up pro-rata by risk. Zero-fee guarantors are therefore
//    the senior tranche.
//
// Every distribution is a pure function of the immutable bet and wager rows,
// and each split assigns the floating-point remainder deterministically so
// the per-wager results sum to the pot exactly (strict zero-sum conservation).

/** One market_guarantees row: a wager of risk at a maker fee rate. */
export interface GuaranteeWager {
    /** Monotonic market-event sequence number (join order). */
    seq: number;
    playerId: string;
    riskAmount: number;
    feeRate: number;
}

/** What settlement needs to know about one buy. */
export interface BetRecord {
    /** Monotonic market-event sequence number (buy order). */
    seq: number;
    playerId: string;
    /** Outcome index (the playground keys outcomes by position). */
    outcome: number;
    /** LMSR cost of the buy, fees excluded. */
    cost: number;
    /** Maker fee charged on top of the cost. */
    fee: number;
    shares: number;
}

/** The market's current maker fee c: the risk-weighted mean of the wager fee rates. Each rate is capped at 0.25 by the UI, so the mean is too. */
export function marketFeeRate(wagers: GuaranteeWager[]): number {
    let weighted = 0;
    let risk = 0;
    for (const w of wagers) {
        weighted += w.feeRate * w.riskAmount;
        risk += w.riskAmount;
    }
    if (risk <= 0) return 0;
    return weighted / risk;
}

/**
 * Maps the total guarantor risk to the LMSR liquidity parameter:
 * b = min(maxLoss, totalRisk)/ln(n). The min keeps each guarantor's maximum
 * loss at their risked amount (the combined worst case is b·ln(n)).
 */
export function liquidityBForRisk(maxLoss: number, totalRisk: number, outcomeCount: number): number {
    if (outcomeCount < 2 || totalRisk <= 0) return 0;
    const effective = Math.min(maxLoss, totalRisk);
    return effective / Math.log(outcomeCount);
}

/** standbyRate is the standby fraction ρ of the current liquidity envelope (min(maxGuarantorLoss, Σrisk) — the b·ln(n) worst case) that every backed trade accrues as a floor, even when the book itself carries no uncovered liability: idle-but-present capital earns a per-trade royalty in proportion to the trading it enabled. Deliberately hardcoded (ADR-23) — not expected to be tuned per deployment. */
const STANDBY_RATE = 0.1;

/**
 * exposureAccruals replays the bet stream (in seq order) and samples, at every
 * bet, the house's live worst-case liability
 *
 *   V = max( max_i Q_i − collected , standbyRate·min(maxGuarantorLoss, Σrisk_active) )
 *
 * (uncovered outstanding shares, floored at the standby rate of the current
 * liquidity envelope), crediting it to the wagers active at that bet (joined
 * no later than the bet — the fee pool's window) in proportion to their risk.
 * The weights are sequence-only: identical event sequences yield identical
 * accruals regardless of wall-clock spacing (ADR-23).
 */
function exposureAccruals(bets: BetRecord[], ordered: GuaranteeWager[], maxGuarantorLoss: number): number[] {
    const accruals = new Array<number>(ordered.length).fill(0);
    const risk = ordered.map((w) => w.riskAmount);
    const totalRisk = risk.reduce((sum, v) => sum + v, 0);
    const q = new Map<number, number>();
    let collected = 0;
    for (const bet of bets) {
        q.set(bet.outcome, (q.get(bet.outcome) ?? 0) + bet.shares);
        collected += bet.cost;

        let maxQ = 0;
        for (const v of q.values()) {
            if (v > maxQ) maxQ = v;
        }
        let sumRisk = 0;
        for (let i = 0; i < ordered.length; i++) {
            if (ordered[i].seq <= bet.seq) sumRisk += risk[i];
        }
        // Sequence inversion (no wager joined yet): treat all wagers as active
        // — the same conservation fallback activeFeeWeights uses.
        const allActive = sumRisk <= 0;
        if (allActive) sumRisk = totalRisk;
        let v = maxQ - collected;
        const floor = STANDBY_RATE * Math.min(maxGuarantorLoss, sumRisk);
        if (floor > v) v = floor;
        if (v <= 0) continue;
        for (let i = 0; i < ordered.length; i++) {
            if (allActive || ordered[i].seq <= bet.seq) {
                accruals[i] += (v * risk[i]) / sumRisk;
            }
        }
    }
    return accruals;
}

/** activeFeeWeights returns the fee·risk weights of the wagers active for a bet (joined no later than the bet). Falls back to all wagers when the window is empty or has zero weight — possible only through a sequence inversion of concurrently committed rows; the fallback keeps the fee fully attributed (zero-sum) and stays a pure function of the stored rows. */
function activeFeeWeights(ordered: GuaranteeWager[], feeWeight: number[], betSeq: number): number[] {
    const active = new Array<number>(ordered.length).fill(0);
    let sum = 0;
    for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].seq <= betSeq) {
            active[i] = feeWeight[i];
            sum += feeWeight[i];
        }
    }
    if (sum > 0) return active;
    return feeWeight;
}

/** allocate splits `total` across wagers proportionally to `weights`, adding to `acc` and assigning the FP remainder to the last weighted wager so the split sums to total exactly. Zero-weight wagers receive nothing. */
function allocate(total: number, weights: number[], acc: number[]): void {
    if (total === 0) return;
    let sum = 0;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
        if (weights[i] > 0) {
            sum += weights[i];
            last = i;
        }
    }
    if (sum <= 0 || last < 0) return;
    let assigned = 0;
    for (let i = 0; i < weights.length; i++) {
        if (weights[i] > 0 && i !== last) {
            const share = (total * weights[i]) / sum;
            acc[i] += share;
            assigned += share;
        }
    }
    acc[last] += total - assigned;
}

/** capSlack is the FP slack allowed on a waterfall cap comparison: relative to the cap plus an absolute dust floor. It bounds a wager's loss overshoot at max(1e-9·risk, 1e-12). */
function capSlack(cap: number): number {
    return cap * 1e-9 + 1e-12;
}

/**
 * cappedProportional splits `total` across wagers proportionally to `weights`,
 * never exceeding the per-wager `caps` beyond capSlack — classic water-filling:
 * wagers whose proportional share exceeds their cap are fixed at the cap and
 * the remainder is redistributed among the rest. The final pass assigns the
 * exact remainder to the last open wager so allocations sum to total. Returns
 * per-wager allocations (all zero for non-positive total).
 */
function cappedProportional(total: number, weights: number[], caps: number[]): number[] {
    const alloc = new Array<number>(weights.length).fill(0);
    if (total <= 0) return alloc;
    // All-zero weights allocate nothing — the caller decides the fallback
    // (e.g. the waterfall's senior tier), so parking the total here would
    // bypass it.
    const open = weights.map((w, i) => w > 0 && caps[i] > 0);
    if (!open.some(Boolean)) return alloc;
    for (;;) {
        let wsum = 0;
        let last = -1;
        for (let i = 0; i < weights.length; i++) {
            if (open[i]) {
                wsum += weights[i];
                last = i;
            }
        }
        if (wsum <= 0 || last < 0) break;
        if (!weights.some((w, i) => open[i] && (total * w) / wsum > caps[i] + capSlack(caps[i]))) {
            let assigned = 0;
            for (let i = 0; i < weights.length; i++) {
                if (open[i] && i !== last) {
                    const share = (total * weights[i]) / wsum;
                    alloc[i] += share;
                    assigned += share;
                }
            }
            alloc[last] += total - assigned;
            if (alloc[last] < 0) alloc[last] = 0;
            return alloc;
        }
        // Fix every over-cap wager at its cap and continue with the remainder.
        for (let i = 0; i < weights.length; i++) {
            if (open[i] && (total * weights[i]) / wsum > caps[i] + capSlack(caps[i])) {
                alloc[i] += caps[i];
                total -= caps[i];
                open[i] = false;
            }
        }
    }
    if (total > 1e-12) {
        // Uncovered remainder after every cap bound. Up to capSlack it is FP
        // dust — park it on the largest cap so the split stays exact. Beyond
        // that the market is insolvent (the deficit exceeds the combined
        // risk): impossible under consistent AMM accounting (loss ≤ b·ln(n) ≤
        // Σrisk, ADR-22) and reachable only from pre-repair rescaled states —
        // the remainder is dropped, never charged to a guarantor beyond their
        // wager.
        let best = 0;
        for (let i = 0; i < caps.length; i++) {
            if (caps[i] > caps[best]) best = i;
        }
        if (total <= capSlack(caps[best])) {
            alloc[best] += total;
        }
    } else if (total < 0) {
        // Over-allocated by FP dust after capping: trim the last filled wager.
        for (let i = alloc.length - 1; i >= 0; i--) {
            if (alloc[i] > 0) {
                alloc[i] += total;
                if (alloc[i] < 0) alloc[i] = 0;
                break;
            }
        }
    }
    return alloc;
}

/**
 * settleGuarantors computes the per-player guarantor net result (positive =
 * earned, negative = staked) from the bet stream and wagers. residual is the
 * equity residual (collected − paid, fees excluded); maxGuarantorLoss is the
 * market's immutable liquidity cap L. The returned shares sum to residual +
 * feePool exactly, except when the deficit exceeds the combined risk
 * (insolvency): then no wager is charged beyond its risk and the uncovered
 * remainder is dropped (see cappedProportional). Empty wagers yield an empty
 * map (callers skip guarantor rows entirely — possible only for bet-less
 * markets).
 */
export function settleGuarantors(
    bets: BetRecord[],
    wagers: GuaranteeWager[],
    maxGuarantorLoss: number,
    residual: number,
): Map<string, number> {
    if (wagers.length === 0) return new Map();

    // Deterministic wager order (the seq is unique, matching the server's
    // ORDER BY created_at, id).
    const ordered = [...wagers].sort((a, b) => a.seq - b.seq);

    const perWager = new Array<number>(ordered.length).fill(0);
    const risk = ordered.map((w) => w.riskAmount);
    const feeWeight = ordered.map((w) => w.feeRate * w.riskAmount);

    // Fee pool, attributed time-windowed per bet.
    for (const bet of bets) {
        if (bet.fee <= 0) continue;
        const weights = activeFeeWeights(ordered, feeWeight, bet.seq);
        allocate(bet.fee, weights, perWager);
    }

    // Equity residual: exposure-accrual split on surplus (ADR-23), first-loss
    // waterfall on deficit.
    if (residual >= 0) {
        let weights = exposureAccruals(bets, ordered, maxGuarantorLoss);
        const sumWeights = weights.reduce((sum, w) => sum + w, 0);
        if (sumWeights <= 0) {
            // Degenerate (a surplus with no bet events ever sampled): fall
            // back to the plain risk-proportional split.
            weights = risk;
        }
        allocate(residual, weights, perWager);
    } else {
        let deficit = -residual;
        // Tier 1: fee-charging wagers, weighted fee·risk, capped at their risk.
        const tier1 = ordered.map((w, i) => (w.feeRate > 0 ? feeWeight[i] : 0));
        const paid = cappedProportional(deficit, tier1, risk);
        for (let i = 0; i < paid.length; i++) {
            perWager[i] -= paid[i];
            deficit -= paid[i];
        }
        if (deficit > 0) {
            // Tier 2: everyone with remaining capacity, weighted by risk.
            const capacity = paid.map((p, i) => risk[i] - p);
            const tier2 = cappedProportional(deficit, risk, capacity);
            for (let i = 0; i < tier2.length; i++) {
                perWager[i] -= tier2[i];
            }
        }
    }

    const shares = new Map<string, number>();
    for (let i = 0; i < ordered.length; i++) {
        shares.set(ordered[i].playerId, (shares.get(ordered[i].playerId) ?? 0) + perWager[i]);
    }
    return shares;
}
