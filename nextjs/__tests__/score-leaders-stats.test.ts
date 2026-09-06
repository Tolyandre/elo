import { describe, expect, it } from "vitest";
import type { Base58ID } from "@/lib/id";
import type { GameMatch, GameMatchPlayer } from "@/app/api";
import {
    computeWinnerScoreStats,
    formatPlayerCount,
} from "@/app/games/view/score-leaders-stats";

function player(id: string, score: number): GameMatchPlayer {
    return {
        id: id as Base58ID,
        name: id,
        score,
        rating_staked: 0,
        rating_earned: 0,
        rating_after: 0,
    };
}

function match(players: GameMatchPlayer[]): GameMatch {
    return {
        id: Math.random().toString(36).slice(2) as Base58ID,
        date: null,
        players,
        tournaments: [],
    };
}

describe("computeWinnerScoreStats", () => {
    it("returns empty array for no matches", () => {
        expect(computeWinnerScoreStats([])).toEqual([]);
    });

    it("skips matches without players and groups sections by player count ascending", () => {
        const matches = [
            match([player("A", 10), player("B", 5)]),
            match([]),
            match([player("A", 8), player("B", 4), player("C", 6)]),
            match([player("A", 3), player("B", 9)]),
        ];
        const sections = computeWinnerScoreStats(matches);
        expect(sections.map(s => s.playerCount)).toEqual([2, 3]);
        expect(sections.map(s => s.matchCount)).toEqual([2, 1]);
    });

    it("counts only the winner score, not the second place", () => {
        const sections = computeWinnerScoreStats([match([player("A", 30), player("B", 55)])]);
        expect(sections[0].distribution).toEqual([
            { from: 55, to: 56, count: 1, label: "55" },
        ]);
        expect(sections[0].topScores).toEqual([
            { score: 55, achievers: [{ name: "B", count: 1 }] },
        ]);
    });

    it("treats every player sharing the top score as a winner", () => {
        const sections = computeWinnerScoreStats([
            match([player("A", 10), player("B", 10), player("C", 5)]),
        ]);
        expect(sections[0].distribution[0].count).toBe(1);
        expect(sections[0].topScores[0].achievers).toEqual([
            { name: "A", count: 1 },
            { name: "B", count: 1 },
        ]);
    });

    it("builds one bin per integer score with step 1 for small spans", () => {
        const sections = computeWinnerScoreStats([
            match([player("A", 10), player("B", 1)]),
            match([player("A", 12), player("B", 1)]),
            match([player("A", 10), player("B", 1)]),
            match([player("A", 15), player("B", 1)]),
        ]);
        expect(sections[0].distribution).toEqual([
            { from: 10, to: 11, count: 2, label: "10" },
            { from: 11, to: 12, count: 0, label: "11" },
            { from: 12, to: 13, count: 1, label: "12" },
            { from: 13, to: 14, count: 0, label: "13" },
            { from: 14, to: 15, count: 0, label: "14" },
            { from: 15, to: 16, count: 1, label: "15" },
        ]);
    });

    it("collapses to a single bin when all winner scores are equal", () => {
        const sections = computeWinnerScoreStats([
            match([player("A", 7), player("B", 1)]),
            match([player("A", 7), player("B", 2)]),
            match([player("A", 7), player("B", 3)]),
        ]);
        expect(sections[0].distribution).toEqual([
            { from: 7, to: 8, count: 3, label: "7" },
        ]);
    });

    it("widens the bin step when the span exceeds the bin limit", () => {
        // Winner scores 0..20 → span 20 needs 21 bins at step 1, so step 2.
        const matches = Array.from({ length: 21 }, (_, score) =>
            match([player("A", score), player("B", -1)]));
        const distribution = computeWinnerScoreStats(matches)[0].distribution;
        expect(distribution).toHaveLength(11);
        expect(distribution[0]).toEqual({ from: 0, to: 2, count: 2, label: "0–1" });
        expect(distribution[10]).toEqual({ from: 20, to: 22, count: 1, label: "20–21" });
    });

    it("aggregates top scores descending and repeats achiever names with counts", () => {
        const matches = [
            match([player("Alice", 30), player("Bob", 10)]),
            match([player("Alice", 30), player("Bob", 10)]),
            match([player("Bob", 40), player("Alice", 10)]),
        ];
        const sections = computeWinnerScoreStats(matches);
        expect(sections[0].topScores).toEqual([
            { score: 40, achievers: [{ name: "Bob", count: 1 }] },
            { score: 30, achievers: [{ name: "Alice", count: 2 }] },
        ]);
    });

    it("keeps at most 5 top scores", () => {
        const matches = Array.from({ length: 8 }, (_, i) =>
            match([player("A", 100 - i), player("B", 0)]));
        const topScores = computeWinnerScoreStats(matches)[0].topScores;
        expect(topScores.map(t => t.score)).toEqual([100, 99, 98, 97, 96]);
    });

    it("sorts achievers of one score by count then name", () => {
        const matches = [
            match([player("Zoe", 50), player("A", 1)]),
            match([player("Amy", 50), player("B", 1)]),
            match([player("Amy", 50), player("C", 1)]),
        ];
        const sections = computeWinnerScoreStats(matches);
        expect(sections[0].topScores[0].achievers).toEqual([
            { name: "Amy", count: 2 },
            { name: "Zoe", count: 1 },
        ]);
    });
});

describe("formatPlayerCount", () => {
    it.each([
        [1, "1 игрок"],
        [2, "2 игрока"],
        [4, "4 игрока"],
        [5, "5 игроков"],
        [11, "11 игроков"],
        [12, "12 игроков"],
        [14, "14 игроков"],
        [21, "21 игрок"],
        [22, "22 игрока"],
        [25, "25 игроков"],
        [111, "111 игроков"],
    ])("renders %i as %s", (n, expected) => {
        expect(formatPlayerCount(n)).toBe(expected);
    });
});
