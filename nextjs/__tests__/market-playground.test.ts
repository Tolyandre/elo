import { describe, expect, it } from "vitest";
import {
    awaitsGuarantors,
    currentFeeRate,
    initialPlaygroundState,
    joinAsGuarantor,
    liquidityB,
    placeBet,
    playgroundOutcomeId,
    probabilities,
    resolveMarket,
    totalRisk,
} from "@/app/help/markets/playground/playground";
import { costForShares, marginalProbability } from "@/app/markets/lmsr";

const CONFIG = { outcomeCount: 3, maxGuarantorLoss: 16 };
const ANYA = "Anya";
const BORYA = "Borya";
const VERA = "Vera";

function backedState() {
    const base = initialPlaygroundState(CONFIG);
    return joinAsGuarantor(base, ANYA, 8, 0.05);
}

describe("playground market", () => {
    it("awaits guarantors until the first join and refuses bets then", () => {
        const base = initialPlaygroundState(CONFIG);
        expect(awaitsGuarantors(base)).toBe(true);
        expect(liquidityB(base)).toBe(0);
        // The safety net: a bet on a guarantor-less market changes nothing.
        const after = placeBet(base, ANYA, 0, 1);
        expect(after).toBe(base);
    });

    it("maps the joined risk to liquidity and the mean fee", () => {
        const state = backedState();
        expect(totalRisk(state)).toBe(8);
        expect(liquidityB(state)).toBeCloseTo(8 / Math.log(3), 12);
        expect(currentFeeRate(state)).toBeCloseTo(0.05, 12);
    });

    it("shows uniform probabilities before trading and records a history point per action", () => {
        const state = backedState();
        expect(probabilities(state)).toEqual([1 / 3, 1 / 3, 1 / 3]);
        expect(state.points).toHaveLength(1);
    });

    it("charges cost + fee = stake exactly and moves q by the bought shares", () => {
        const state = backedState();
        const after = placeBet(state, BORYA, 0, 1);
        expect(after).not.toBe(state);
        const bet = after.bets[0];
        expect(bet.cost + bet.fee).toBeCloseTo(1, 9);
        expect(after.q[0]).toBeCloseTo(bet.shares, 12);
        expect(costForShares(state.q, liquidityB(state), 0, bet.shares)).toBeCloseTo(bet.cost, 9);
        // The probability of the bought outcome rises above the uniform 1/3.
        expect(marginalProbability(after.q, liquidityB(after), 0)).toBeGreaterThan(1 / 3);
        expect(after.points).toHaveLength(2);
    });

    it("moves prices back toward uniform when a guarantor joins over a fixed q", () => {
        const state = backedState();
        const afterBet = placeBet(state, BORYA, 0, 1);
        const before = probabilities(afterBet);
        const afterJoin = joinAsGuarantor(afterBet, VERA, 16, 0);
        const after = probabilities(afterJoin);
        for (let i = 0; i < 3; i++) {
            expect(Math.abs(after[i] - 1 / 3)).toBeLessThan(Math.abs(before[i] - 1 / 3));
        }
    });

    it("settles winning shares at 1 and leaves the residual with the guarantors", () => {
        let state = backedState();
        state = placeBet(state, BORYA, 0, 1);
        state = placeBet(state, VERA, 1, 2);
        const resolution = resolveMarket(state, 0);

        const borya = resolution.players.find((p) => p.player_id === BORYA)!;
        const vera = resolution.players.find((p) => p.player_id === VERA)!;
        expect(borya.earned).toBeCloseTo(state.bets[0].shares, 9);
        expect(borya.staked).toBeCloseTo(1, 9);
        expect(vera.earned).toBe(0);
        expect(vera.staked).toBeCloseTo(2, 9);

        // Strict zero-sum: player nets + guarantor nets = 0.
        const guarantors = resolution.guarantors.reduce((sum, g) => sum + g.earned - g.staked, 0);
        const players = resolution.players.reduce((sum, p) => sum + p.earned - p.staked, 0);
        expect(players + guarantors).toBeCloseTo(0, 9);

        expect(residualFeeMatches(resolution)).toBe(true);
    });

    it("keys history points by playground outcome ids", () => {
        const state = backedState();
        expect(Object.keys(state.points[0].probabilities)).toEqual([
            playgroundOutcomeId(0),
            playgroundOutcomeId(1),
            playgroundOutcomeId(2),
        ]);
    });
});

function residualFeeMatches(resolution: { feeCollected: number; residual: number; players: { staked: number; earned: number }[] }): boolean {
    // collected (fees excluded) − paid = residual, and staked − feeCollected
    // is what the players netted among themselves.
    const collected = resolution.players.reduce((sum, p) => sum + p.staked, 0) - resolution.feeCollected;
    const paid = resolution.players.reduce((sum, p) => sum + p.earned, 0);
    return Math.abs(collected - paid - resolution.residual) < 1e-9;
}
