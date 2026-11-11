// The client-side settlement preview (ADR-37): both tracks mirror
// elo-web-service — the Elo math via app/eloCalculation.ts, the rating track
// via pkg/elo/arena_calc.go:buildArenaResults. Advisory only: the sync always
// replaces the preview with the server's settlement.
import { describe, expect, it } from "vitest";

import {
    priorHistoryPoint,
    previewSettlement,
    type PreviewCatchUp,
    type PreviewSettings,
} from "../lib/offline/elo-preview";

const P1 = "p1";
const P2 = "p2";
const P3 = "p3";

const SETTINGS: PreviewSettings = {
    k: 32,
    d: 400,
    startingElo: 1000,
    winReward: 1,
    startingRatingDefault: 0,
};

const NO_HISTORY = new Map<string, null>([[P1, null], [P2, null]]);

describe("previewSettlement — elo track", () => {
    it("computes the classic two-player case from equal starting elos", () => {
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history: NO_HISTORY,
            settings: SETTINGS,
        });
        expect(preview).not.toBeNull();
        // Equal elos → E = 0.5 → staked = −16 both; normalized share 1 / 0.
        expect(preview![P1].eloStaked).toBeCloseTo(-16, 10);
        expect(preview![P1].eloEarned).toBeCloseTo(32, 10);
        expect(preview![P2].eloStaked).toBeCloseTo(-16, 10);
        expect(preview![P2].eloEarned).toBeCloseTo(0, 10);
        expect(preview![P1].eloAfter).toBeCloseTo(1016, 10);
        expect(preview![P2].eloAfter).toBeCloseTo(984, 10);
    });

    it("is zero-sum across the players", () => {
        const preview = previewSettlement({
            scores: { [P1]: 12, [P2]: 7, [P3]: 3 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history: NO_HISTORY,
            settings: SETTINGS,
        })!;
        const total = Object.values(preview).reduce((sum, r) => sum + r.eloStaked + r.eloEarned, 0);
        expect(total).toBeCloseTo(0, 8);
    });

    it("settles an unknown player from the starting elo — the server's rule", () => {
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history: new Map([[P1, { elo: 1200, rating: 1100 }], [P2, null]]),
            settings: SETTINGS,
        })!;
        expect(preview[P1].eloBefore).toBe(1200);
        expect(preview[P2].eloBefore).toBe(1000);
        // The stronger player stakes more against the beginner (a bigger
        // expected share), so a win earns less net than the beginner loses.
        expect(preview[P1].eloStaked).toBeLessThan(preview[P2].eloStaked);
        expect(preview[P1].eloAfter).toBeGreaterThan(preview[P1].eloBefore);
        expect(preview[P2].eloAfter).toBeLessThan(preview[P2].eloBefore);
    });

    it("uses the prior point strictly before the match date", () => {
        const history = new Map([
            [P1, { elo: 1300, rating: 1200 }],
            [P2, { elo: 900, rating: 950 }],
        ]);
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history,
            settings: SETTINGS,
        })!;
        expect(preview[P1].eloBefore).toBe(1300);
        expect(preview[P1].ratingBefore).toBe(1200);
    });

    it("returns null for fewer than two players (coop never settles)", () => {
        expect(
            previewSettlement({
                scores: { [P1]: 10 },
                matchDate: new Date("2026-01-09T12:00:00.000Z"),
                history: NO_HISTORY,
                settings: SETTINGS,
            }),
        ).toBeNull();
        expect(
            previewSettlement({
                scores: {},
                matchDate: new Date("2026-01-09T12:00:00.000Z"),
                history: NO_HISTORY,
                settings: SETTINGS,
            }),
        ).toBeNull();
    });
});

describe("previewSettlement — rating track", () => {
    it("mirrors the elo track when rating equals elo (no catch-up needed)", () => {
        const history = new Map([
            [P1, { elo: 1100, rating: 1100 }],
            [P2, { elo: 1000, rating: 1000 }],
        ]);
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history,
            settings: SETTINGS,
        })!;
        expect(preview[P1].ratingStaked).toBeCloseTo(preview[P1].eloStaked, 10);
        expect(preview[P1].ratingEarned).toBeCloseTo(preview[P1].eloEarned, 10);
        expect(preview[P1].ratingAfter).toBeCloseTo(preview[P1].eloAfter, 10);
    });

    it("amplifies the earned when the rating still catches up to the elo", () => {
        // gap = 100, tau = 100 → t = 1 − e^−1 ≈ 0.632; earned maps from [0, K]
        // onto [earnedMin·t, K + (earnedMax−K)·t].
        const catchUp: PreviewCatchUp = { earnedMin: 2, earnedMax: 64, tau: 100 };
        const history = new Map([
            [P1, { elo: 1100, rating: 1000 }],
            [P2, { elo: 1000, rating: 1000 }],
        ]);
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history,
            settings: SETTINGS,
            catchUp,
        })!;
        // Full share S=1: earned = effMin + 1·(effMax − effMin) = effMax > K.
        expect(preview[P1].ratingEarned).toBeGreaterThan(32);
        expect(preview[P1].ratingAfter).toBeCloseTo(1000 + preview[P1].ratingStaked + preview[P1].ratingEarned, 10);
    });

    it("skips the scaling without arena catch_up parameters (best effort)", () => {
        const history = new Map([
            [P1, { elo: 1100, rating: 1000 }],
            [P2, { elo: 1000, rating: 1000 }],
        ]);
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history,
            settings: SETTINGS,
        })!;
        expect(preview[P1].ratingEarned).toBeCloseTo(preview[P1].eloEarned, 10);
    });

    it("falls back to the starting rating for players without history", () => {
        const preview = previewSettlement({
            scores: { [P1]: 10, [P2]: 0 },
            matchDate: new Date("2026-01-09T12:00:00.000Z"),
            history: NO_HISTORY,
            settings: SETTINGS,
        })!;
        expect(preview[P1].ratingBefore).toBe(0);
        expect(preview[P2].ratingBefore).toBe(0);
    });
});

describe("priorHistoryPoint", () => {
    const at = (iso: string) => new Date(iso);

    it("picks the latest point strictly before the match date", () => {
        const history = [
            { date: "2026-01-01T00:00:00.000Z", rating: 1000, elo: 1000 },
            { date: "2026-01-05T00:00:00.000Z", rating: 1010, elo: 1020 },
            { date: "2026-01-09T12:00:00.000Z", rating: 1030, elo: 1050 }, // at the match — excluded
        ];
        expect(priorHistoryPoint(history, at("2026-01-09T12:00:00.000Z"))).toEqual({ elo: 1020, rating: 1010 });
        expect(priorHistoryPoint(history, at("2026-01-06T00:00:00.000Z"))).toEqual({ elo: 1020, rating: 1010 });
    });

    it("returns null when every point is at/after the match or history is empty", () => {
        const history = [{ date: "2026-01-09T12:00:00.000Z", rating: 1000, elo: 1000 }];
        expect(priorHistoryPoint(history, at("2026-01-01T00:00:00.000Z"))).toBeNull();
        expect(priorHistoryPoint([], at("2026-01-09T12:00:00.000Z"))).toBeNull();
    });
});
