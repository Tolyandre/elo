// Display helpers for offline edit ops (ADR-37): the synthesized pending
// match card input and the audit-style change rows the /offline queue shows.
import { describe, expect, it } from "vitest";

import { Base58ID } from "../lib/id";
import {
    MATCH_FIELD_LABELS,
    opChangeRows,
    opEntityName,
    pendingMatchFromOp,
} from "../lib/offline/op-display";
import { PendingOp } from "../lib/offline/types";

const MATCH_ID = "match1" as Base58ID;
const GAME_ID = "game1" as Base58ID;
const GAME2_ID = "game2" as Base58ID;
const P1 = "p1" as Base58ID;
const P2 = "p2" as Base58ID;

const helpers = {
    gameName: (id: string) => (id === GAME_ID ? "Скull King" : `игра ${id}`),
    playerName: (id: string) => `игрок ${id}`,
    campName: (id: string) => `кэмп ${id}`,
};

function matchOp(base: Record<string, unknown>, patch: Record<string, unknown>): PendingOp {
    return {
        entityId: MATCH_ID,
        kind: "match",
        op: "update",
        createdAt: "2026-01-01T10:00:00.000Z",
        status: "pending",
        base,
        patch,
    };
}

describe("pendingMatchFromOp", () => {
    it("overlays the patch on the base", () => {
        const m = pendingMatchFromOp(
            matchOp(
                { game_id: GAME_ID, date: "2026-01-05T18:00:00.000Z", score: { [P1]: 10, [P2]: 20 }, camp_arena_ids: ["c1"] },
                { score: { [P1]: 15, [P2]: 20 } },
            ),
        );
        expect(m.clientId).toBe(MATCH_ID);
        expect(m.gameId).toBe(GAME_ID);
        expect(m.score).toEqual({ [P1]: 15, [P2]: 20 });
        expect(m.campArenaIds).toEqual(["c1"]);
        expect(m.status).toBe("pending");
    });

    it("dates the card by the match's own date, not the queue time", () => {
        const m = pendingMatchFromOp(
            matchOp({ game_id: GAME_ID, date: "2026-01-05T18:00:00.000Z", score: {} }, {}),
        );
        expect(m.createdAt).toBe("2026-01-05T18:00:00.000Z");
    });

    it("carries the coop fields through", () => {
        const m = pendingMatchFromOp(
            matchOp(
                { game_id: GAME_ID, date: "d", score: {}, mode: "coop", player_ids: [P1], game_score: 42, game_won: false, camp_arena_ids: [] },
                { game_won: true },
            ),
        );
        expect(m.mode).toBe("coop");
        expect(m.playerIds).toEqual([P1]);
        expect(m.gameScore).toBe(42);
        expect(m.gameWon).toBe(true);
    });
});

describe("opChangeRows", () => {
    it("lists only the fields the patch actually changes", () => {
        const rows = opChangeRows(
            "match",
            { game_id: GAME_ID, date: "2026-01-05T18:00:00.000Z", score: { [P1]: 10 } },
            { game_id: GAME_ID, date: "2026-01-06T19:00:00.000Z", score: { [P1]: 10 } },
            helpers,
        );
        // Date strings are locale-dependent (formatDateTime) — assert the row
        // shape, not the rendering.
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe("value");
        expect(rows[0].label).toBe("Дата");
        if (rows[0].kind === "value") {
            expect(rows[0].from).toBeTruthy();
            expect(rows[0].from).not.toBe(rows[0].to);
        }
    });

    it("renders score changes per player, with join/leave notes", () => {
        const rows = opChangeRows(
            "match",
            { score: { [P1]: 10, [P2]: 20 } },
            { score: { [P1]: 12 } },
            helpers,
        );
        expect(rows).toEqual([
            { kind: "score", label: "игрок p1", change: "changed", from: "10", to: "12" },
            { kind: "score", label: "игрок p2", change: "removed", from: "20", to: null },
        ]);
    });

    it("renders camp and participant diffs as joined/left names", () => {
        const rows = opChangeRows(
            "match",
            { camp_arena_ids: ["c1"], player_ids: [P1] },
            { camp_arena_ids: ["c1", "c2"], player_ids: [P2] },
            helpers,
        );
        expect(rows).toEqual([
            { kind: "collection", label: MATCH_FIELD_LABELS.player_ids, added: ["игрок p2"], removed: ["игрок p1"] },
            { kind: "collection", label: MATCH_FIELD_LABELS.camp_arena_ids, added: ["кэмп c2"], removed: [] },
        ]);
    });

    it("skips a patch field the resolution reset to the base value", () => {
        const rows = opChangeRows(
            "match",
            { game_id: GAME_ID, score: {} },
            { game_id: GAME2_ID, score: {} },
            helpers,
        );
        expect(rows).toEqual([
            { kind: "value", label: "Игра", from: "Скull King", to: "игра game2" },
        ]);
        // Same field, patch == base → no visible change (post-resolution state).
        expect(opChangeRows("match", { game_id: GAME_ID, score: {} }, { game_id: GAME_ID, score: {} }, helpers)).toEqual([]);
    });

    it("labels player renames and game metadata with the audit labels", () => {
        expect(
            opChangeRows("player", { name: "Старое" }, { name: "Новое" }, helpers),
        ).toEqual([{ kind: "value", label: "Имя", from: "Старое", to: "Новое" }]);

        const rows = opChangeRows(
            "game",
            { alias: null, name_ru: "Старое рус", name_en: null, game_mode: "competitive", bgg_ref: 1, tesera_ref: null },
            { alias: "sk", name_ru: "Новое рус", name_en: null, game_mode: "coop", bgg_ref: 2, tesera_ref: null },
            helpers,
        );
        expect(rows).toEqual([
            { kind: "value", label: "Алиас", from: null, to: "sk" },
            { kind: "value", label: "Название (рус)", from: "Старое рус", to: "Новое рус" },
            { kind: "value", label: "Режим", from: "Только соревновательная", to: "Кооператив или сольная" },
            { kind: "value", label: "BGG", from: "1", to: "2" },
        ]);
    });

    it("formats coop result fields", () => {
        const rows = opChangeRows(
            "match",
            { game_score: 40, game_won: false },
            { game_score: 45, game_won: true },
            helpers,
        );
        expect(rows).toEqual([
            { kind: "value", label: "Игровой счёт", from: "40", to: "45" },
            { kind: "value", label: "Результат", from: "Поражение", to: "Победа" },
        ]);
    });
});

describe("opEntityName", () => {
    it("names a player from the queued fields", () => {
        expect(opEntityName({ ...matchOp({}, {}), kind: "player", base: { name: "Аня" }, patch: { name: "Аня II" } })).toBe("Аня II");
    });

    it("derives a game's display name alias → ru → en, never the id", () => {
        expect(
            opEntityName({
                ...matchOp({}, {}),
                kind: "game",
                base: { alias: null, name_ru: "Русское", name_en: "English" },
                patch: { alias: "sk" },
            }),
        ).toBe("sk");
        expect(
            opEntityName({
                ...matchOp({}, {}),
                kind: "game",
                base: { alias: null, name_ru: null, name_en: "English" },
                patch: {},
            }),
        ).toBe("English");
    });

    it("returns nothing for matches", () => {
        expect(opEntityName(matchOp({}, {}))).toBeUndefined();
    });
});
