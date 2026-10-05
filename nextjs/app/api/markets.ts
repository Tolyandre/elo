// Markets: LMSR share trading (ADR-10), the probability history, and the
// voluntary guarantor wagers (ADR-20).
import { client, unwrap, newId } from "./client";
import type { Market, MarketDetail } from "./types";
import type { Base58ID } from "@/lib/id";

export async function getMarketsPromise(): Promise<{ active: Market[]; closed: Market[] }> {
    return (await unwrap(client.GET("/markets"))).data;
}

export async function getMarketByIdPromise(id: Base58ID): Promise<MarketDetail> {
    return (await unwrap(client.GET("/markets/{id}", { params: { path: { id } } }))).data;
}

export interface MarketProbabilityPoint {
    t: string;
    probabilities: { outcome_id: Base58ID; probability: number }[];
}

// The probability history is reconstructed server-side by replaying the bet
// stream through the LMSR; each point carries the probability (LMSR marginal
// price) of every outcome right after a bet (the probabilities sum to 1).
export async function getMarketProbabilityHistoryPromise(id: Base58ID): Promise<MarketProbabilityPoint[]> {
    return (await unwrap(client.GET("/markets/{id}/probability-history", { params: { path: { id } } }))).data.points;
}

export async function createMarketPromise(payload: {
    market_type: "match_winner" | "win_streak" | "tournament_winner";
    starts_at: string | null;
    // Required for match_winner/win_streak; tournament_winner markets take no
    // deadline — their fate is the tournament's.
    closes_at?: string;
    target_player_ids?: Base58ID[];
    allow_other_players?: boolean;
    game_ids?: Base58ID[];
    target_player_id?: Base58ID;
    streak_game_ids?: Base58ID[];
    wins_required?: number | null;
    max_losses?: number | null;
    tournament_id?: Base58ID;
    max_guarantor_loss?: number;
}): Promise<{ id: Base58ID }> {
    return (await unwrap(client.POST("/markets", {
        body: {
            id: newId(),
            ...payload,
            starts_at: payload.starts_at ?? undefined,
            wins_required: payload.wins_required ?? undefined,
            max_guarantor_loss: payload.max_guarantor_loss ?? undefined,
        },
    }))).data;
}

export async function deleteMarketPromise(id: Base58ID): Promise<void> {
    await unwrap(client.DELETE("/markets/{id}", { params: { path: { id } } }));
}

export async function closeMarketBettingPromise(id: Base58ID): Promise<void> {
    await unwrap(client.PATCH("/markets/{id}", {
        params: { path: { id } },
        body: { status: "betting_closed" },
    }));
}

export async function getMarketsByMatchIdPromise(matchId: Base58ID): Promise<Market[]> {
    return (await unwrap(client.GET("/matches/{id}/markets", {
        params: { path: { id: matchId } },
    }))).data ?? [];
}

export async function placeBetPromise(marketId: Base58ID, outcomeId: Base58ID, expectedProbability: number, shares = 1): Promise<{ shares: number; cost_per_share: number; fee: number }> {
    // Shares-driven buy (ADR-10): the AMM prices the elo cost of `shares`
    // (default one share; the fixed-amount mode inverts the LMSR cost client
    // side to get the share count for its amount). expectedProbability is the
    // outcome probability the user saw — the server rejects the bet (409) if
    // the live probability has moved beyond a tolerance. cost_per_share
    // includes the maker fee (ADR-20), which the guarantors earn at resolution.
    const res = await unwrap(client.POST("/markets/{id}/bets", {
        params: { path: { id: marketId } },
        body: { id: newId(), outcome_id: outcomeId, shares, expected_probability: expectedProbability },
    }));
    return { shares: res.data.shares, cost_per_share: res.data.cost_per_share, fee: res.data.fee };
}

// A guarantee is the player's voluntary, immutable guarantor wager (ADR-20):
// the risk amount (their maximum loss, reserved against the betting limit)
// and their maker fee rate. The market's liquidity grows without moving
// prices; wagers over-subscribing the market's L are accepted but add no
// liquidity.
export async function createGuaranteePromise(marketId: Base58ID, riskAmount: number, feeRate: number): Promise<{
    risk_amount: number;
    fee_rate: number;
    liquidity_b: number;
    total_risk: number;
    max_guarantor_loss: number;
}> {
    const res = await unwrap(client.POST("/markets/{id}/guarantees", {
        params: { path: { id: marketId } },
        body: { id: newId(), risk_amount: riskAmount, fee_rate: feeRate },
    }));
    return res.data;
}
