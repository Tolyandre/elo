// The client-side match entity (ADR-37): one read model over the server read,
// the pending-create queue and the queued edit op. Whatever a surface shows
// through MatchEntity.effective is what the sync will PUT.
import { describe, expect, it } from "vitest";

import { Base58ID } from "../lib/id";
// app/api/types directly: the app/api barrel throws on a missing env var at
// import time, and the test only needs the frontend Match shape + helper.
import { matchSettled, type Match } from "../app/api/types";
import {
    MatchEntity,
    applyMatchOp,
    matchEditInputs,
    opToMatch,
    pendingMatchToMatch,
    withLocalSettlement,
} from "../lib/offline/match-entity";
import { PendingMatch, PendingOp } from "../lib/offline/types";

const MATCH_ID = "match1" as Base58ID;
const GAME_ID = "game1" as Base58ID;
const GAME2_ID = "game2" as Base58ID;
const P1 = "p1" as Base58ID;
const P2 = "p2" as Base58ID;
const P3 = "p3" as Base58ID;

const helpers = {
    gameName: (id: string) => (id === GAME_ID ? "Скull King" : `игра ${id}`),
    playerName: (id: string) => `игрок ${id}`,
    campName: (id: string) => `кэмп ${id}`,
};

function savedMatch(): Match {
    return {
        id: MATCH_ID,
        game_id: GAME_ID,
        game_name: "Скull King",
        date: new Date("2026-01-05T18:00:00.000Z"),
        dateISO: "2026-01-05T18:00:00.000Z",
        score: {
            [P1]: { ratingStaked: -10, ratingEarned: 22, score: 10, ratingAfter: 1012 },
            [P2]: { ratingStaked: -10, ratingEarned: 4, score: 5, ratingAfter: 994 },
        },
        has_markets: false,
        mode: "competitive",
        game_score: null,
        game_won: null,
        camps: [{ id: "c1" as Base58ID, name: "Кэмп один" }],
        tournament: null,
    };
}

function matchOp(base: Record<string, unknown>, patch: Record<string, unknown>): PendingOp {
    return {
        entityId: MATCH_ID,
        kind: "match",
        op: "update",
        createdAt: "2026-01-10T10:00:00.000Z",
        status: "pending",
        base,
        patch,
    };
}

// The base a MatchForm edit captures: the match as the form observed it.
function savedBase(m: Match): Record<string, unknown> {
    return {
        game_id: m.game_id,
        date: m.dateISO,
        score: Object.fromEntries(Object.entries(m.score).map(([pid, s]) => [pid, s.score])),
        camp_arena_ids: m.camps.map((c) => c.id),
    };
}

describe("MatchEntity.resolve", () => {
    it("returns null when no source knows the match", () => {
        expect(MatchEntity.resolve(MATCH_ID, {})).toBeNull();
    });

    it("resolves from each source alone", () => {
        const pending: PendingMatch = {
            clientId: MATCH_ID,
            createdAt: "2026-01-09T12:00:00.000Z",
            status: "pending",
            gameId: GAME_ID,
            score: { [P1]: 10, [P2]: 5 },
            campArenaIds: [],
        };
        expect(MatchEntity.resolve(MATCH_ID, { pending })?.isPendingCreate).toBe(true);
        expect(MatchEntity.resolve(MATCH_ID, { saved: savedMatch() })?.hasPendingChanges).toBe(false);
        expect(MatchEntity.resolve(MATCH_ID, { op: matchOp({}, {}) })?.hasPendingChanges).toBe(true);
    });

    it("surfaces the queue status from the pending item or the op", () => {
        const op = { ...matchOp({}, {}), status: "error" as const, error: "boom" };
        const entity = MatchEntity.resolve(MATCH_ID, { saved: savedMatch(), op });
        expect(entity?.status).toBe("error");
        expect(entity?.error).toBe("boom");
    });
});

describe("pendingMatchToMatch (queued create)", () => {
    it("converts a competitive create with unset settlement columns", () => {
        const pm: PendingMatch = {
            clientId: MATCH_ID,
            createdAt: "2026-01-09T12:00:00.000Z",
            status: "pending",
            gameId: GAME_ID,
            score: { [P1]: 10, [P2]: 5 },
            campArenaIds: ["c2" as Base58ID],
        };
        const view = pendingMatchToMatch(pm, helpers);
        expect(view.id).toBe(MATCH_ID);
        expect(view.game_id).toBe(GAME_ID);
        expect(view.mode).toBe("competitive");
        expect(view.date).toEqual(new Date(pm.createdAt));
        expect(view.score[P1]).toEqual({ ratingStaked: null, ratingEarned: null, score: 10, ratingAfter: null });
        // No settlement columns → matchSettled false → the card hides the
        // server widgets and the Elo preview fills the column.
        expect(matchSettled(view)).toBe(false);
        expect(view.camps).toEqual([{ id: "c2", name: "кэмп c2" }]);
    });

    it("converts a coop create: participants become zero-score rows", () => {
        const pm: PendingMatch = {
            clientId: MATCH_ID,
            createdAt: "2026-01-09T12:00:00.000Z",
            status: "pending",
            gameId: GAME_ID,
            score: {},
            mode: "coop",
            playerIds: [P1, P2],
            gameScore: 42,
            gameWon: true,
            campArenaIds: [],
        };
        const view = pendingMatchToMatch(pm);
        expect(view.mode).toBe("coop");
        expect(view.game_score).toBe(42);
        expect(view.game_won).toBe(true);
        expect(Object.keys(view.score).sort()).toEqual([P1, P2].sort());
        expect(view.score[P1]).toEqual({ ratingStaked: null, ratingEarned: null, score: 0, ratingAfter: null });
    });
});

describe("applyMatchOp (queued edit over the server read)", () => {
    it("merges scores per key: changed, added, removed", () => {
        const m = savedMatch();
        // The edit: p1 10→12, p2 removed, p3 added.
        const op = matchOp(savedBase(m), { score: { [P1]: 12, [P3]: 7 }, camp_arena_ids: m.camps.map((c) => c.id) });
        const view = applyMatchOp(m, op, helpers);
        expect(Object.keys(view.score).sort()).toEqual([P1, P3].sort());
        expect(view.score[P1].score).toBe(12);
        expect(view.score[P3].score).toBe(7);
    });

    it("keeps an untouched score at the server's value even when the server changed", () => {
        const m = savedMatch();
        // base p1=10, patch p1=10 (untouched) — the server has since moved it to 99.
        const server = savedMatch();
        server.score[P1] = { ...server.score[P1], score: 99 };
        const op = matchOp(savedBase(m), { score: { [P1]: 10, [P2]: 5 }, camp_arena_ids: [] });
        const view = applyMatchOp(server, op);
        expect(view.score[P1].score).toBe(99);
    });

    it("keeps players the server added since the base (never observed → never overridden)", () => {
        const m = savedMatch();
        const PS = "ps" as Base58ID;
        const server = savedMatch();
        server.score[PS] = { ratingStaked: null, ratingEarned: null, score: 8, ratingAfter: null };
        // The base predates PS; the patch reuses the stale observed set.
        const op = matchOp(
            { game_id: m.game_id, date: m.dateISO, score: { [P1]: 10, [P2]: 5 }, camp_arena_ids: [] },
            { score: { [P1]: 10, [P2]: 5 }, camp_arena_ids: [] },
        );
        const view = applyMatchOp(server, op);
        expect(view.score[PS].score).toBe(8);
    });

    it("keeps the observed set when the patch carries no score map at all", () => {
        const m = savedMatch();
        const op = matchOp(savedBase(m), { date: "2026-01-06T19:00:00.000Z" });
        const view = applyMatchOp(m, op);
        expect(Object.keys(view.score).sort()).toEqual([P1, P2].sort());
    });

    it("nulls the settlement columns so the preview replaces the stale server deltas", () => {
        const m = savedMatch();
        const op = matchOp(savedBase(m), { score: { [P1]: 11, [P2]: 5 }, camp_arena_ids: [] });
        const view = applyMatchOp(m, op);
        expect(matchSettled(view)).toBe(false);
        expect(view.score[P1].ratingStaked).toBeNull();
        expect(view.score[P1].ratingAfter).toBeNull();
    });

    it("keeps the server name for the same game, blanks it for a swap", () => {
        const m = savedMatch();
        const same = applyMatchOp(m, matchOp(savedBase(m), { score: { [P1]: 11, [P2]: 5 }, camp_arena_ids: [] }));
        expect(same.game_name).toBe("Скull King");
        const swapped = applyMatchOp(
            m,
            matchOp(savedBase(m), { game_id: GAME2_ID, score: { [P1]: 11, [P2]: 5 }, camp_arena_ids: [] }),
        );
        expect(swapped.game_id).toBe(GAME2_ID);
        // The card resolves the new game's name from the games context.
        expect(swapped.game_name).toBe("");
    });

    it("applies the date and camp set, resolving new camp names", () => {
        const m = savedMatch();
        const op = matchOp(savedBase(m), {
            date: "2026-01-06T19:00:00.000Z",
            camp_arena_ids: ["c1" as Base58ID, "c2" as Base58ID],
        });
        const view = applyMatchOp(m, op, helpers);
        expect(view.dateISO).toBe("2026-01-06T19:00:00.000Z");
        expect(view.date).toEqual(new Date("2026-01-06T19:00:00.000Z"));
        expect(view.camps).toEqual([
            { id: "c1", name: "Кэмп один" }, // known from the server read
            { id: "c2", name: "кэмп c2" }, // queued addition, resolved by helper
        ]);
    });

    it("unions coop participants with the score keys", () => {
        const m = { ...savedMatch(), mode: "coop" as const, game_score: 40, game_won: false };
        const base = { ...savedBase(m), mode: "coop", player_ids: [P1, P2], game_score: 40, game_won: false };
        const op = matchOp(base, { game_score: 45 });
        const view = applyMatchOp(m, op);
        expect(view.game_score).toBe(45);
        expect(view.game_won).toBe(false);
        expect(Object.keys(view.score).sort()).toEqual([P1, P2].sort());
    });
});

describe("opToMatch (the op without a server read)", () => {
    it("builds the display state from the op's fields, dating by the match date", () => {
        const op = matchOp(
            { game_id: GAME_ID, date: "2026-01-05T18:00:00.000Z", score: { [P1]: 10, [P2]: 20 }, camp_arena_ids: ["c1"] },
            { score: { [P1]: 15, [P2]: 20 } },
        );
        const view = opToMatch(op, helpers);
        expect(view.id).toBe(MATCH_ID);
        expect(view.game_id).toBe(GAME_ID);
        expect(view.date).toEqual(new Date("2026-01-05T18:00:00.000Z"));
        expect(view.score[P1]).toEqual({ ratingStaked: null, ratingEarned: null, score: 15, ratingAfter: null });
        expect(view.score[P2].score).toBe(20);
        expect(view.camps).toEqual([{ id: "c1", name: "кэмп c1" }]);
    });

    it("falls back to the queue time when the op carries no date", () => {
        const op = matchOp({ game_id: GAME_ID, score: {} }, {});
        const view = opToMatch(op);
        expect(view.date).toEqual(new Date(op.createdAt));
    });

    it("drops base score keys the patch omits (user-removed)", () => {
        const op = matchOp(
            { game_id: GAME_ID, date: "d", score: { [P1]: 10, [P2]: 20 } },
            { score: { [P1]: 15 } },
        );
        const view = opToMatch(op);
        expect(Object.keys(view.score).sort()).toEqual([P1]);
        expect(view.score[P1].score).toBe(15);
    });

    it("carries the calculator fields through", () => {
        const data = { version: 1, rounds: [] };
        const op = matchOp(
            { game_id: GAME_ID, date: "d", score: {}, calculator_kind: "skull-king", calculator_data: { version: 1 } },
            { calculator_data: data },
        );
        const view = opToMatch(op);
        expect(view.calculator_kind).toBe("skull-king");
        expect(view.calculator_data).toEqual(data);
    });
});

describe("matchEditInputs (re-edit accumulates)", () => {
    it("prefills from the op-overlaid state and keeps the original merge base", () => {
        const m = savedMatch();
        // First edit queued: p1 10→12. The server read is still stale.
        const firstOp = matchOp(savedBase(m), { score: { [P1]: 12, [P2]: 5 }, camp_arena_ids: m.camps.map((c) => c.id) });
        const { view, base } = matchEditInputs(m, firstOp, helpers);
        expect(view.score[P1].score).toBe(12);
        expect(view.score[P2].score).toBe(5);
        // The base is the first edit's observed server state (verbatim), not
        // the overlaid state — the second edit's complete patch merges
        // against it without losing the first edit's changes.
        expect(base).toBe(firstOp.base);
        expect(base).toEqual(savedBase(m));
    });

    it("returns a null base for a first edit (caller captures from the server read)", () => {
        const { view, base } = matchEditInputs(savedMatch(), null, helpers);
        expect(view.game_name).toBe("Скull King");
        expect(view.score[P1].score).toBe(10); // untouched server state
        expect(base).toBeNull();
    });
});

describe("MatchEntity.changes", () => {
    it("delegates to the audit-style change rows", () => {
        const op = matchOp(
            { game_id: GAME_ID, score: { [P1]: 10, [P2]: 20 } },
            { score: { [P1]: 12 } },
        );
        const entity = MatchEntity.resolve(MATCH_ID, { saved: savedMatch(), op });
        expect(entity?.changes(helpers)).toEqual([
            { kind: "score", label: "игрок p1", change: "changed", from: "10", to: "12" },
            { kind: "score", label: "игрок p2", change: "removed", from: "20", to: null },
        ]);
    });

    it("renders an opaque calculator_data change without values", () => {
        const op = matchOp(
            { game_id: GAME_ID, score: {}, calculator_kind: "skull-king", calculator_data: { version: 1 } },
            { calculator_data: { version: 1, rounds: [1] } },
        );
        const entity = MatchEntity.resolve(MATCH_ID, { op });
        expect(entity?.changes(helpers)).toEqual([{ kind: "opaque", label: "Данные калькулятора" }]);
    });

    it("shows nothing for a pending create (no server state to diff)", () => {
        const entity = MatchEntity.resolve(MATCH_ID, {
            pending: {
                clientId: MATCH_ID,
                createdAt: "2026-01-09T12:00:00.000Z",
                status: "pending",
                gameId: GAME_ID,
                score: {},
                campArenaIds: [],
            },
        });
        expect(entity?.changes(helpers)).toEqual([]);
    });
});

// ─── withLocalSettlement (ADR-38) ─────────────────────────────────────────────

describe("withLocalSettlement", () => {
    const local = {
        p1: { ratingStaked: -5.5, ratingEarned: 21.5, ratingAfter: 1016 },
        p2: { ratingStaked: -16, ratingEarned: 0, ratingAfter: 984 },
    };

    it("fills the unset settlement columns of a pending display state", () => {
        const view = pendingMatchToMatch({
            clientId: MATCH_ID,
            createdAt: "2026-01-09T12:00:00.000Z",
            status: "pending",
            gameId: GAME_ID,
            score: { p1: 10, p2: 5 },
            campArenaIds: [],
        });
        expect(matchSettled(view)).toBe(false);
        const filled = withLocalSettlement(view, local);
        expect(matchSettled(filled)).toBe(true);
        expect(filled.score.p1).toMatchObject({ ratingStaked: -5.5, ratingEarned: 21.5, ratingAfter: 1016 });
        expect(filled.score.p2).toMatchObject({ ratingStaked: -16, ratingEarned: 0, ratingAfter: 984 });
        // The scores themselves are untouched.
        expect(filled.score.p1.score).toBe(10);
    });

    it("keeps server-settled rows and leaves players without a local row null", () => {
        const view: Match = {
            ...pendingMatchToMatch({
                clientId: MATCH_ID,
                createdAt: "2026-01-09T12:00:00.000Z",
                status: "pending",
                gameId: GAME_ID,
                score: { p1: 10, p2: 5 },
                campArenaIds: [],
            }),
            score: {
                p1: { ratingStaked: 3, ratingEarned: 4, score: 10, ratingAfter: 1007 },
                p2: { ratingStaked: null, ratingEarned: null, score: 5, ratingAfter: null },
            },
        };
        const filled = withLocalSettlement(view, { p1: local.p1 });
        // p1 was already settled by the server — untouched.
        expect(filled.score.p1).toBe(view.score.p1);
        // p2 has no local settlement (e.g. not an arena member) — stays null.
        expect(filled.score.p2.ratingStaked).toBeNull();
    });

    it("returns the input untouched without a settlement (pre-ADR-38 rendering)", () => {
        const view = pendingMatchToMatch({
            clientId: MATCH_ID,
            createdAt: "2026-01-09T12:00:00.000Z",
            status: "pending",
            gameId: GAME_ID,
            score: { p1: 10 },
            campArenaIds: [],
        });
        expect(withLocalSettlement(view, null)).toBe(view);
    });
});
