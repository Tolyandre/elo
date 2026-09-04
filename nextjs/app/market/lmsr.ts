// Client-side LMSR math for the buy modes, mirroring the server's AMM
// (elo-web-service/pkg/elo/amm.go): the cost of a q-vector is
// C(q) = b·ln(Σ_j e^(q_j/b)) and buying s shares of outcome i costs
// C(q + s·e_i) − C(q). LMSR is path-independent, so buying s shares at once
// costs exactly as much as s sequential single-share buys — the share and
// fixed-amount buy modes are therefore equivalent in price.

/** Display coefficient for an outcome price: 1/price, i.e. how much a win returns per 1 elo of buying cost (each winning share pays 1). Returns null when the price is not usable (defensive — LMSR prices are in (0,1)). */
export function payoutMultiplier(price: number): number | null {
    if (!Number.isFinite(price) || price <= 0) return null;
    return 1 / price;
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
