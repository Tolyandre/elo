// Client-side LMSR math for the buy modes, mirroring the server's AMM
// (elo-web-service/pkg/elo/amm.go): the cost of a q-vector is
// C(q) = b·ln(Σ_j e^(q_j/b)) and buying s shares of outcome i costs
// C(q + s·e_i) − C(q). LMSR is path-independent, so buying s shares at once
// costs exactly as much as s sequential single-share buys — the share and
// fixed-amount buy modes are therefore equivalent in price.
//
// Guarantors charge a maker fee c (ADR-20): the buyer's marginal price becomes
// p_u = p + 4c·p(1−p) (a variance-proportional, Kalshi-style fee — the
// surcharge peaks at c for p = 0.5 and vanishes at p → 0/1; c ≤ 0.25 keeps
// p_u ≤ 1). Since a buy moves only q_i, the total fee for s shares has the
// closed form 4c·b·Δp_i — mirrored in buyFee below.

/**
 * The LMSR cost of a q-vector, C(q) = b·ln(Σ_j e^(q_j/b)), with the exponents
 * shifted by max(q_j/b) so large q values don't overflow (same stabilization
 * as the server's log-sum-exp).
 */
function cost(q: number[], b: number): number {
    const m = Math.max(...q.map((v) => v / b));
    const sum = q.reduce((acc, v) => acc + Math.exp(v / b - m), 0);
    return b * (m + Math.log(sum));
}

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
 * Elo cost of buying `shares` of outcome `i` at the current q:
 * C(q + shares·e_i) − C(q). This is what a buy actually charges — distinct
 * from the outcome's probability (the LMSR marginal price), which it equals
 * only for an infinitesimal share. With thin markets (small b) the cost of
 * the first share is noticeably above the opening probability.
 */
export function costForShares(q: number[], b: number, i: number, shares: number): number {
    if (!(b > 0) || !(shares > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    const after = q.slice();
    after[i] += shares;
    return cost(after, b) - cost(q, b);
}

/**
 * Number of shares of outcome `i` that `amount` elo buys at the current q,
 * i.e. the exact inverse of the LMSR cost (closed form, no numeric search):
 *
 *   b·ln((R + e^((q_i+s)/b)) / S) = amount
 *   →  s = b·ln((S·e^(amount/b) − R) / e^(q_i/b))
 *
 * where S = Σ_j e^(q_j/b) and R = Σ_{j≠i} e^(q_j/b). Exponents are shifted by
 * max(q_j/b) so large q values don't overflow (same stabilization as the
 * server's log-sum-exp).
 */
export function sharesForAmount(q: number[], b: number, i: number, amount: number): number {
    if (!(b > 0) || !(amount > 0) || q.length < 2 || i < 0 || i >= q.length) {
        return NaN;
    }
    const m = Math.max(...q.map((v) => v / b));
    const e = q.map((v) => Math.exp(v / b - m));
    const s = e.reduce((sum, v) => sum + v, 0);
    const r = s - e[i];
    return b * Math.log((s * Math.exp(amount / b) - r) / e[i]);
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
 * (LMSR cost + maker fee — the "за 1 голос" caption) and the ×multiplier
 * (voices per 1 elo) — exact reciprocals, so multiplier × price = 1. In the
 * share mode the buy is one share at the marginal cost plus its fee. In the
 * amount mode the 1 elo covers cost AND fee (the share count solves
 * cost(s) + fee(s) = 1 by bisection — both terms are increasing in s, and
 * p_u ≤ 1 bounds the solution within [0, amount]).
 */
export function buyQuote(
    q: number[],
    b: number,
    i: number,
    mode: "share" | "amount",
    feeRate = 0,
): { pricePerShare: number; multiplier: number; fee: number } {
    if (mode === "amount") {
        const shares = sharesForTotal(q, b, i, 1, feeRate);
        const fee = buyFee(q, b, i, shares, feeRate);
        const pricePerShare = 1 / shares;
        return { pricePerShare, multiplier: shares, fee };
    }
    const lmsrCost = costForShares(q, b, i, 1);
    const fee = buyFee(q, b, i, 1, feeRate);
    const pricePerShare = lmsrCost + fee;
    return { pricePerShare, multiplier: 1 / pricePerShare, fee };
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
