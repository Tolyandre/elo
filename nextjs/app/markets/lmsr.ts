// Client-side LMSR math for the buy card, mirroring the server's AMM
// (elo-web-service/pkg/elo/amm.go): the cost of a q-vector is
// C(q) = b·ln(Σ_j e^(q_j/b)) and buying s shares of outcome i costs
// C(q + s·e_i) − C(q). LMSR is path-independent, so buying s shares at once
// costs exactly as much as s sequential single-share buys.
//
// Guarantors charge a maker fee c (ADR-20): the buyer's marginal price becomes
// p_u = p + 4c·p(1−p) (a variance-proportional, Kalshi-style fee — the
// surcharge peaks at c for p = 0.5 and vanishes at p → 0/1; c ≤ 0.25 keeps
// p_u ≤ 1). Since a buy moves only q_i, the total fee for s shares has the
// closed form 4c·b·Δp_i — mirrored in buyFee below.

/**
 * The LMSR marginal price (probability) of outcome i — what the donut and the
 * chart show, and the pre-fee per-share price.
 */
export function marginalProbability(q: number[], b: number, i: number): number {
    if (!(b > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    const m = Math.max(...q.map((v) => v / b));
    const e = q.map((v) => Math.exp(v / b - m));
    return e[i] / e.reduce((sum, v) => sum + v, 0);
}

/**
 * The buyer's marginal price including the maker fee: p_u = p + 4c·p(1−p).
 * c ≤ 0.25 keeps p_u within [0, 1] (binding only as p → 1).
 */
export function priceWithFee(p: number, feeRate: number): number {
    return p + 4 * feeRate * p * (1 - p);
}

/**
 * Maker fee for buying `shares` of outcome i at the market's fee rate c
 * (ADR-20): the closed form of ∫ 4c·p_i(1−p_i) dq_i = 4c·b·Δp_i, exact for any
 * outcome count because only q_i moves during a buy. Zero for non-positive b
 * or c.
 */
export function buyFee(q: number[], b: number, i: number, shares: number, feeRate: number): number {
    if (!(b > 0) || !(shares > 0) || !(feeRate > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return 0;
    }
    const after = q.slice();
    after[i] += shares;
    return 4 * feeRate * b * (marginalProbability(after, b, i) - marginalProbability(q, b, i));
}

/**
 * Smallest chargeable LMSR cost — mirrors the server's minBetCost floor
 * (elo-web-service/pkg/elo/amm.go): past a q gap of ~745·b the exact
 * underdog-share cost underflows to exactly 0, which the bets.cost > 0
 * constraint forbids. Rounding up to this dust floor overcharges by less
 * than any displayable amount and is conservation-safe (the surplus lands
 * with the guarantors at settlement).
 */
const MIN_BET_COST = 1e-300;

/** ln Σ_{j≠skip} e^(q_j/b), max-shifted so large q/b cannot overflow. skip < 0 skips nothing. */
function logSumExpSkip(q: number[], b: number, skip: number): number {
    let m = -Infinity;
    for (let j = 0; j < q.length; j++) {
        if (j === skip) continue;
        const v = q[j] / b;
        if (v > m) m = v;
    }
    let sum = 0;
    for (let j = 0; j < q.length; j++) {
        if (j !== skip) sum += Math.exp(q[j] / b - m);
    }
    return m + Math.log(sum);
}

/**
 * Elo cost of buying `shares` of outcome `i` at the current q:
 * C(q + shares·e_i) − C(q). This is what a buy actually charges — distinct
 * from the outcome's probability (the LMSR marginal price), which it equals
 * only for an infinitesimal share. With thin markets (small b) the cost of
 * the first share is noticeably above the opening probability.
 *
 * Computed as the server's stable paired log-sum-exp difference (amm.go),
 * never as a difference of two near-equal C values: at market saturation
 * (a one-sided q gap of ~37·b) the exact underdog-share cost (~1e-16·b) is
 * below one ulp of C(q), so the naive subtraction cancels to exactly 0 and
 * the server would reject the bet (bets.cost > 0). The dominant term is
 * cancelled algebraically per regime instead, keeping ~1e-16 relative
 * accuracy on the cost itself for any b — down to the ~1e-5 liquidity of a
 * guarantor risking 0.00001.
 */
export function costForShares(q: number[], b: number, i: number, shares: number): number {
    if (!(b > 0) || !(shares > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    const u = q[i] / b;
    const v = u + shares / b;
    const w = logSumExpSkip(q, b, i);
    let delta: number;
    if (u >= w) {
        delta = shares / b + Math.log1p(Math.exp(w - v)) - Math.log1p(Math.exp(w - u));
    } else if (v >= w) {
        delta = v - w + Math.log1p(Math.exp(w - v)) - Math.log1p(Math.exp(u - w));
    } else {
        delta = Math.log1p(Math.exp(v - w)) - Math.log1p(Math.exp(u - w));
    }
    const cost = b * delta;
    return cost < MIN_BET_COST ? MIN_BET_COST : cost;
}

/**
 * Number of shares of outcome `i` that `amount` elo buys at the current q,
 * i.e. the exact inverse of the LMSR cost (closed form, no numeric search):
 *
 *   e^{(q_i+s)/b} + R = e^{amount/b}·(e^{q_i/b} + R)
 *   →  s = b·(L + amount/b − q_i/b + ln(1 − e^{r−L−amount/b}))
 *
 * where L = ln Σ_j e^(q_j/b) and r = ln Σ_{j≠i} e^(q_j/b) (both log-sum-exps).
 * Everything stays in log space: the previous form computed S·e^(amount/b)
 * directly, which overflows to Infinity once amount/b > ~709 — i.e. on any
 * market with b < ~0.0014, such as one backed by a guarantor risking 0.00001
 * (b ≈ 1e-5 → amount/b ≈ 110,000) — making the fixed-elo buy unquotable. The
 * exponent r−L−amount/b is always < 0 (buying power strictly exceeds the
 * rest of the market), so the ln(1−e^x) term is finite.
 */
export function sharesForAmount(q: number[], b: number, i: number, amount: number): number {
    if (!(b > 0) || !(amount > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    const l = logSumExpSkip(q, b, -1);
    const r = logSumExpSkip(q, b, i);
    const shares = b * (l - q[i] / b + amount / b + Math.log1p(-Math.exp(r - l - amount / b)));
    return shares > 0 ? shares : NaN;
}

/**
 * Average elo per share of an `amount`-elo buy, i.e. what each delivered share
 * effectively costs: amount / sharesForAmount. Unlike the marginal
 * costForShares(·, 1) — the price of the first share only — it includes the
 * price walk within the buy, so it is the per-share price the bet realizes
 * (and multiplier × price multiplies out to exactly `amount`).
 */
export function averagePricePerShare(q: number[], b: number, i: number, amount: number): number {
    const shares = sharesForAmount(q, b, i, amount);
    return amount / shares;
}

/**
 * The quote a buy card shows for the pending buy: the all-in per-share price
 * (LMSR cost + maker fee) and the ×multiplier — the number of voices the
 * buyer gets for EVERY 1 elo of the buy, `shares/amount` (exact reciprocal
 * of pricePerShare, so multiplier × price = 1 whatever the quoted amount).
 * `fee` is the WHOLE buy's maker fee (ADR-20) — what the guarantor earns on
 * the pending stake, shown by the "Поручители заработают" caption.
 * The buy stakes a fixed amount of elo that covers cost AND fee (the share
 * count solves cost(s) + fee(s) = amount by bisection — both terms are
 * increasing in s, and p_u ≤ 1 bounds the solution within [0, amount]).
 */
export function buyQuote(
    q: number[],
    b: number,
    i: number,
    feeRate = 0,
    amount = 1,
): { pricePerShare: number; multiplier: number; fee: number } {
    const shares = sharesForTotal(q, b, i, amount, feeRate);
    const fee = buyFee(q, b, i, shares, feeRate);
    const pricePerShare = amount / shares;
    return { pricePerShare, multiplier: shares / amount, fee };
}

/**
 * Number of shares of outcome i that `amount` elo buys all-in (LMSR cost plus
 * maker fee) at fee rate c, by bisection on the monotone total: at zero fee
 * this reduces exactly to sharesForAmount. The bracket starts at the amount
 * and doubles — the all-in marginal price p_u < 1 keeps the root slightly
 * above the naive bound.
 */
export function sharesForTotal(q: number[], b: number, i: number, amount: number, feeRate = 0): number {
    if (!(b > 0) || !(amount > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    if (!(feeRate > 0)) {
        return sharesForAmount(q, b, i, amount);
    }
    const total = (s: number) => costForShares(q, b, i, s) + buyFee(q, b, i, s, feeRate);
    let lo = 0;
    let hi = Math.max(1, amount);
    while (total(hi) < amount) {
        hi *= 2;
    }
    for (let iter = 0; iter < 60; iter++) {
        const mid = (lo + hi) / 2;
        if (total(mid) < amount) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return (lo + hi) / 2;
}
