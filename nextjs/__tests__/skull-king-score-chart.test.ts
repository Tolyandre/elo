import { describe, it, expect } from "vitest";
import type { Base58ID } from "@/lib/id";
import type { SkullKingGameState, SkullKingRoundEntry } from "@/app/api";
import { buildScoreChartData } from "@/components/calculators/skull-king/score-chart";

const pid = (s: string) => s as Base58ID;

function state(rounds: (SkullKingRoundEntry | null)[][]): SkullKingGameState {
    return {
        phase: "result-entry",
        players: [{ id: pid("p1"), name: "Аня" }, { id: pid("p2"), name: "Боря" }],
        currentRound: rounds.length,
        currentPlayerIndex: 0,
        rounds,
    };
}

const slot = (bid: number, actual: number | null): SkullKingRoundEntry => ({ bid, actual, bonus: 0 });

describe("buildScoreChartData", () => {
    it("returns no points for an empty game", () => {
        expect(buildScoreChartData(state([]))).toEqual([]);
    });

    it("plots cumulative totals per round, counting only recorded results", () => {
        const points = buildScoreChartData(state([
            [slot(2, 2), slot(3, 1)], // +40 / -20
            [slot(0, 0), slot(1, 2)], // +20 (round 2 zero bid) / -10
        ]));

        expect(points).toEqual([
            { round: 1, p1: 40, p2: -20 },
            { round: 2, p1: 60, p2: -30 },
        ]);
    });

    it("skips rounds without any recorded result", () => {
        const points = buildScoreChartData(state([
            [slot(2, null), slot(3, null)], // bids only
            [slot(2, 2), slot(3, 1)],
        ]));

        expect(points).toEqual([
            { round: 2, p1: 40, p2: -20 },
        ]);
    });

    it("stops a hidden player's line at the last fully completed round", () => {
        const rounds = [
            [slot(2, 2), slot(3, 3)], // completed: +40 / +60
            [slot(2, 1), null], // p1 entered (-10), p2 still hidden
        ];
        const hidden = buildScoreChartData(state(rounds), [1]);
        expect(hidden).toEqual([
            { round: 1, p1: 40, p2: 60 },
            { round: 2, p1: 30 },
        ]);

        // Without hiding, the partial round shows both running totals.
        const visible = buildScoreChartData(state(rounds));
        expect(visible[1]).toEqual({ round: 2, p1: 30, p2: 60 });
    });
});
