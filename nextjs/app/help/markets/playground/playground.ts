// Playground market state for the help page: a fully local market that
// mirrors the server's flow (ADR-20/22/23) with the real math — the LMSR
// functions of @/app/markets/lmsr (the same ones the market page uses) and
// the guarantor settlement ported in ./guarantor-settlement. No backend, no
// credit limits, fictional players.
//
// Events (bets and guarantee joins) share one monotonic `seq` counter, which
// is what the settlement's time-windowed attribution orders by.

import { SettlementDetail } from "@/app/api";
import { ProbabilityPoint } from "@/app/markets/probabilityHistory";
import { buyFee, costForShares, marginalProbability, sharesForTotal } from "@/app/markets/lmsr";
import { toBase58ID, type Base58ID } from "@/lib/id";
import {
    BetRecord,
    GuaranteeWager,
    liquidityBForRisk,
    marketFeeRate,
    settleGuarantors,
} from "./guarantor-settlement";

export { liquidityBForRisk, marketFeeRate } from "./guarantor-settlement";

/** Mint a fixture id: the playground only ever passes its own known-valid strings. */
function fid(s: string): Base58ID {
    const minted = toBase58ID(s);
    if (!minted) throw new Error(`playground: "${s}" is not a Base58 id`);
    return minted;
}

/** The players one can act as. Ids are display names in Base58 form (the settlement list reuses the market page's components). */
export const PLAYGROUND_PLAYERS = [
    { id: fid("Anya"), name: "Аня" },
    { id: fid("Borya"), name: "Боря" },
    { id: fid("Vera"), name: "Вера" },
    { id: fid("Gosha"), name: "Гоша" },
    { id: fid("Dasha"), name: "Даша" },
] as const;

export interface PlaygroundConfig {
    outcomeCount: number;
    maxGuarantorLoss: number;
}

export interface PlaygroundState {
    outcomeCount: number;
    maxGuarantorLoss: number;
    /** LMSR q vector, one position per outcome. */
    q: number[];
    bets: BetRecord[];
    guarantees: GuaranteeWager[];
    /** Probability history: one point per action (bet or guarantor join). */
    points: ProbabilityPoint[];
    /** Last used event sequence number. */
    seq: number;
}

export function playgroundOutcomeId(i: number): Base58ID {
    return fid(`outcome${i + 1}`);
}

export function playgroundOutcomeName(i: number): string {
    return `Исход ${i + 1}`;
}

export function initialPlaygroundState(config: PlaygroundConfig): PlaygroundState {
    return {
        outcomeCount: config.outcomeCount,
        maxGuarantorLoss: config.maxGuarantorLoss,
        q: new Array(config.outcomeCount).fill(0),
        bets: [],
        guarantees: [],
        points: [],
        seq: 0,
    };
}

/** Total guarantor risk currently committed. */
export function totalRisk(state: PlaygroundState): number {
    return state.guarantees.reduce((sum, g) => sum + g.riskAmount, 0);
}

/** The market's LMSR liquidity: 0 while awaiting guarantors. */
export function liquidityB(state: PlaygroundState): number {
    return liquidityBForRisk(state.maxGuarantorLoss, totalRisk(state), state.outcomeCount);
}

/** The market's maker fee c (risk-weighted mean of the wager fee rates). */
export function currentFeeRate(state: PlaygroundState): number {
    return marketFeeRate(state.guarantees);
}

export function awaitsGuarantors(state: PlaygroundState): boolean {
    return liquidityB(state) <= 0;
}

/** The probability of every outcome (uniform 1/n while awaiting guarantors — the same display convention as the server). */
export function probabilities(state: PlaygroundState): number[] {
    const b = liquidityB(state);
    if (!(b > 0)) return state.q.map(() => 1 / state.outcomeCount);
    return state.q.map((_, i) => marginalProbability(state.q, b, i));
}

function nextPoint(state: PlaygroundState): ProbabilityPoint {
    const probs = probabilities(state);
    // Keep timestamps strictly increasing so the chart's x-domain always
    // advances even for rapid clicks in the same millisecond.
    const lastT = state.points.length > 0 ? state.points[state.points.length - 1].t : -Infinity;
    return {
        t: Math.max(Date.now(), lastT + 1),
        probabilities: Object.fromEntries(probs.map((p, i) => [playgroundOutcomeId(i), p])),
    };
}

/**
 * A fixed-amount buy (ADR-10/17): the share count solves cost(s) + fee(s) =
 * amount client-side, exactly like the market page's buy card. Returns the
 * state unchanged while the market awaits guarantors (b = 0) — the UI keeps
 * the cards disabled, this is the safety net.
 */
export function placeBet(state: PlaygroundState, playerId: string, outcomeIndex: number, amount: number): PlaygroundState {
    const b = liquidityB(state);
    if (!(b > 0) || !(amount > 0) || outcomeIndex < 0 || outcomeIndex >= state.outcomeCount) {
        return state;
    }
    const feeRate = currentFeeRate(state);
    const seq = state.seq + 1;
    const shares = sharesForTotal(state.q, b, outcomeIndex, amount, feeRate);
    const cost = costForShares(state.q, b, outcomeIndex, shares);
    const fee = buyFee(state.q, b, outcomeIndex, shares, feeRate);
    const q = state.q.map((v, i) => (i === outcomeIndex ? v + shares : v));
    const next: PlaygroundState = {
        ...state,
        seq,
        q,
        bets: [...state.bets, { seq, playerId, outcome: outcomeIndex, cost, fee, shares }],
        points: [...state.points, nextPoint(state)],
    };
    return next;
}

/**
 * A guarantor join: the wager's risk reserves liquidity, and b is recomputed
 * over the unchanged q (ADR-22) — prices move toward the uniform vector.
 */
export function joinAsGuarantor(state: PlaygroundState, playerId: string, riskAmount: number, feeRate: number): PlaygroundState {
    if (!(riskAmount > 0) || !(feeRate >= 0) || feeRate > 0.25) {
        return state;
    }
    const seq = state.seq + 1;
    const next: PlaygroundState = {
        ...state,
        seq,
        guarantees: [...state.guarantees, { seq, playerId, riskAmount, feeRate }],
        points: [...state.points, nextPoint(state)],
    };
    return next;
}

export interface PlaygroundResolution {
    outcomeIndex: number;
    /** Per-player result: staked = Σ(cost + fee), earned = winning shares × 1. */
    players: SettlementDetail[];
    /** Per-guarantor net (the real waterfall/accrual algorithm). */
    guarantors: SettlementDetail[];
    feeCollected: number;
    /** Equity residual: collected − paid, fees excluded (ADR-23's split input). */
    residual: number;
}

/**
 * Settles the market against a winning outcome: every winning share pays 1,
 * the residual goes to the guarantors (fee pool + equity split — see
 * ./guarantor-settlement).
 */
export function resolveMarket(state: PlaygroundState, outcomeIndex: number): PlaygroundResolution {
    const collected = state.bets.reduce((sum, bet) => sum + bet.cost, 0);
    const feeCollected = state.bets.reduce((sum, bet) => sum + bet.fee, 0);
    const paid = state.bets
        .filter((bet) => bet.outcome === outcomeIndex)
        .reduce((sum, bet) => sum + bet.shares, 0);
    const residual = collected - paid;

    const stakedByPlayer = new Map<string, number>();
    const earnedByPlayer = new Map<string, number>();
    for (const bet of state.bets) {
        stakedByPlayer.set(bet.playerId, (stakedByPlayer.get(bet.playerId) ?? 0) + bet.cost + bet.fee);
        if (bet.outcome === outcomeIndex) {
            earnedByPlayer.set(bet.playerId, (earnedByPlayer.get(bet.playerId) ?? 0) + bet.shares);
        }
    }
    const nameOf = (playerId: string) => PLAYGROUND_PLAYERS.find((p) => p.id === playerId)?.name ?? playerId;
    const players: SettlementDetail[] = [...stakedByPlayer.keys()].map((playerId) => ({
        player_id: fid(playerId),
        player_name: nameOf(playerId),
        staked: stakedByPlayer.get(playerId) ?? 0,
        earned: earnedByPlayer.get(playerId) ?? 0,
    }));

    // SettlementList renders earned − staked; a guarantor's net maps to
    // (staked = loss, earned = win) so the signed column stays the net.
    const guarantors: SettlementDetail[] = [...settleGuarantors(state.bets, state.guarantees, state.maxGuarantorLoss, residual)]
        .map(([playerId, net]) => ({
            player_id: fid(playerId),
            player_name: nameOf(playerId),
            staked: net < 0 ? -net : 0,
            earned: net > 0 ? net : 0,
        }))
        // The waterfall/accrual order is meaningful — keep it by contribution.
        .sort((a, b) => a.player_id.localeCompare(b.player_id));

    return { outcomeIndex, players, guarantors, feeCollected, residual };
}
