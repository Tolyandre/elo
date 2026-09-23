import { describe, expect, it } from "vitest";
import {
    BetRecord,
    GuaranteeWager,
    liquidityBForRisk,
    marketFeeRate,
    settleGuarantors,
} from "@/app/help/markets/playground/guarantor-settlement";

// Mirrors elo-web-service/pkg/elo/guarantees_math_test.go and
// guarantees_settlement_test.go: the playground's guarantor settlement must
// produce the server's numbers. The Go tests order events by timestamps; here
// the same sequences are expressed with the playground's monotonic seq.

function wager(seq: number, playerId: string, risk: number, fee: number): GuaranteeWager {
    return { seq, playerId, riskAmount: risk, feeRate: fee };
}

function bet(seq: number, outcome: number, shares: number, cost: number, fee = 0): BetRecord {
    return { seq, playerId: "buyer", outcome, shares, cost, fee };
}

const approxEq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// --- fee rate / liquidity mapping --------------------------------------------

describe("marketFeeRate", () => {
    it("is the risk-weighted mean of the wager fee rates", () => {
        // (0.10·3 + 0·1)/(3+1) = 0.075 — big zero-fee wagers pull the fee down.
        expect(marketFeeRate([wager(1, "p1", 3, 0.10), wager(2, "p2", 1, 0.00)])).toBeCloseTo(0.075, 12);
    });

    it("is zero without wagers", () => {
        expect(marketFeeRate([])).toBe(0);
    });
});

describe("liquidityBForRisk", () => {
    it("is min(L, Σrisk)/ln(n) — honest risk", () => {
        expect(liquidityBForRisk(16, 8, 2)).toBeCloseTo(8 / Math.LN2, 12);
    });

    it("caps at the max loss", () => {
        expect(liquidityBForRisk(16, 40, 2)).toBeCloseTo(16 / Math.LN2, 12);
    });

    it("is zero without risk", () => {
        expect(liquidityBForRisk(16, 0, 2)).toBe(0);
    });
});

// --- cappedProportional (through the deficit waterfall) ------------------------

describe("settleGuarantors: deficit waterfall", () => {
    const wagers = [wager(1, "p1", 2, 0.25), wager(2, "p2", 6, 0.05), wager(3, "p3", 10, 0.00)];

    it("fee-charging wagers pay first, capped at their risk; senior tranche waits", () => {
        // Deficit 8: tier-1 weights {0.5, 0.3} would split 5/3, but p1 caps at
        // its risk 2, so the remaining 6 lands on p2 (exactly p2's risk).
        const shares = settleGuarantors([], wagers, 16, -8);
        expect(shares.get("p1")).toBeCloseTo(-2, 9);
        expect(shares.get("p2")).toBeCloseTo(-6, 9);
        expect(shares.get("p3")).toBe(0);
    });

    it("spills to the zero-fee senior tranche pro-rata by remaining risk", () => {
        // Deficit 17 exhausts p1 (2) and p2 (6); p3 covers 9 of its 10.
        const shares = settleGuarantors([], wagers, 16, -17);
        expect(shares.get("p1")).toBeCloseTo(-2, 9);
        expect(shares.get("p2")).toBeCloseTo(-6, 9);
        expect(shares.get("p3")).toBeCloseTo(-9, 9);
    });

    it("never charges a wager beyond its risk when insolvent", () => {
        // Deficit 118.6 exceeds Σrisk = 4.1: the pot lands at exactly −Σrisk.
        const shares = settleGuarantors([], [wager(1, "a", 0.1, 0), wager(2, "b", 4, 0)], 16, -118.6);
        const total = [...shares.values()].reduce((s, v) => s + v, 0);
        expect(total).toBeCloseTo(-4.1, 9);
    });
});

// --- fee pool ------------------------------------------------------------------

describe("settleGuarantors: fee pool time windows", () => {
    it("attributes a fee to the wagers active at the bet, weighted fee·risk", () => {
        // p1 (4, 5%) joins first, p2 (4, 20%) later; a bet between the joins
        // attributes only to p1 despite p2's higher weight.
        const wagers = [wager(1, "p1", 4, 0.05), wager(3, "p2", 4, 0.20)];
        const bets = [bet(2, 0, 0, 0, 1.0), bet(4, 0, 0, 0, 3.0)];
        const shares = settleGuarantors(bets, wagers, 16, 0);
        // Between: 1.0 → p1. After: 3.0 split 1:4 → 0.6 p1, 2.4 p2.
        expect(shares.get("p1")).toBeCloseTo(1.6, 9);
        expect(shares.get("p2")).toBeCloseTo(2.4, 9);
    });

    it("keeps the pool fully attributed through the conservation fallback", () => {
        // Only a zero-fee wager was active at the bet — the fallback spreads
        // the fee over all wagers by fee·risk; conservation is the invariant.
        const wagers = [wager(1, "p1", 4, 0), wager(3, "p2", 4, 0.10)];
        const shares = settleGuarantors([bet(2, 0, 0, 0, 1.0)], wagers, 16, 0);
        expect(shares.get("p1")! + shares.get("p2")!).toBeCloseTo(1.0, 9);
    });
});

// --- equity residual -------------------------------------------------------------

describe("settleGuarantors: equity residual", () => {
    it("falls back to pro-rata by risk on a bet-less surplus", () => {
        const wagers = [wager(1, "p1", 3, 0.10), wager(2, "p2", 1, 0.00)];
        const shares = settleGuarantors([], wagers, 16, 8);
        expect(shares.get("p1")).toBeCloseTo(6, 9);
        expect(shares.get("p2")).toBeCloseTo(2, 9);
    });

    it("splits a surplus by exposure accrual (ADR-23 worked example)", () => {
        // Equal risks; bet 1 creates real liability while only G1 is active
        // (accrual 0.9), bet 2 hits the standby floor (0.8 each).
        const wagers = [wager(1, "g1", 8, 0), wager(3, "g2", 8, 0)];
        const bets = [bet(2, 0, 2, 1.10), bet(4, 1, 2, 1.30)];
        const shares = settleGuarantors(bets, wagers, 16, 0.4);
        expect(shares.get("g1")).toBeCloseTo(0.272, 9);
        expect(shares.get("g2")).toBeCloseTo(0.128, 9);
    });

    it("pays the standby royalty proportional to backed trades", () => {
        // A thin early guarantor backing the first 2 trades alone, a deep late
        // one (joining after them) present for 3 more; weights 0.05 vs 1.2
        // over a residual of 13.
        const wagers = [wager(1, "thin", 0.1, 0), wager(4, "deep", 4, 0)];
        const bets = [
            bet(2, 0, 1, 1),
            bet(3, 0, 1, 1),
            bet(5, 0, 1, 1),
            bet(6, 0, 1, 1),
            bet(7, 0, 1, 1),
        ];
        const shares = settleGuarantors(bets, wagers, 16, 13);
        expect(shares.get("thin")).toBeCloseTo((13 * 0.05) / 1.25, 9);
        expect(shares.get("deep")).toBeCloseTo((13 * 1.2) / 1.25, 9);
    });
});

// --- conservation -----------------------------------------------------------------

describe("settleGuarantors: conservation", () => {
    it("sums to feePool + residual exactly across combined pots", () => {
        const wagers = [wager(1, "p1", 4, 0.10), wager(2, "p2", 6, 0.00), wager(3, "p1", 2, 0.20)];
        const bets = [bet(2, 0, 1, 1, 0.9), bet(4, 0, 1, 1, 1.6)];
        const shares = settleGuarantors(bets, wagers, 16, -5.0);
        const total = [...shares.values()].reduce((s, v) => s + v, 0);
        expect(Math.abs(total - (0.9 + 1.6 - 5.0))).toBeLessThan(1e-9);
        // The same player's two wagers aggregate into one net.
        expect(shares.has("p1")).toBe(true);
        expect(shares.size).toBe(2);
    });

    it("yields an empty map without wagers", () => {
        expect(settleGuarantors([bet(1, 0, 1, 0.5, 0.01)], [], 16, 1).size).toBe(0);
    });

    it("is a pure function of the ordered event stream (replay-safe)", () => {
        // The bet stream arrives in seq order (the server orders by placed_at);
        // identical sequences must settle identically regardless of wager
        // array order (the port re-sorts wagers by seq).
        const wagers = [wager(1, "g1", 8, 0), wager(3, "g2", 8, 0)];
        const bets = [bet(2, 0, 2, 1.10), bet(4, 1, 2, 1.30)];
        const a = settleGuarantors(bets, wagers, 16, 0.4);
        const b = settleGuarantors([...bets], [...wagers].reverse(), 16, 0.4);
        for (const [pid, v] of a) {
            expect(approxEq(b.get(pid)!, v)).toBe(true);
        }
    });
});
