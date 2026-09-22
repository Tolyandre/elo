import { describe, it, expect } from "vitest";
import type { Base58ID } from "@/lib/id";
import type { IawwGameState, SkullKingGameState, TablePlayer } from "@/app/api";
import {
    GAME_APPS,
    GAME_ID_SKULL_KING,
    GAME_ID_IAWW,
    TABLE_PAGE_PATH,
    gameAppByGameId,
    isSkullKingState,
    isIawwState,
    mergeTableStates,
} from "@/lib/game-apps";

const pid = (s: string) => s as Base58ID;

const PLAYERS: TablePlayer[] = [
    { id: pid("p1"), name: "Аня" },
    { id: pid("p2"), name: "Боря" },
    { id: pid("p3"), name: "Вера" },
];

describe("game app registry", () => {
    it("every game app opens into the unified table page", () => {
        expect(GAME_APPS.map((a) => a.id)).toEqual([GAME_ID_SKULL_KING, GAME_ID_IAWW]);
        for (const app of GAME_APPS) {
            expect(app.href).toBe(TABLE_PAGE_PATH);
            expect(app.minPlayers).toBe(2);
        }
    });

    it("skull king: a created table starts round 1 waiting for bids, roster in order", () => {
        const state = gameAppByGameId(GAME_ID_SKULL_KING)!.createInitialState(PLAYERS);
        if (!isSkullKingState(state)) throw new Error("expected a Skull King state");
        expect(state.phase).toBe("waiting-for-bids");
        expect(state.currentRound).toBe(1);
        expect(state.currentPlayerIndex).toBe(0);
        expect(state.players).toEqual(PLAYERS);
        // Round 1 slots are pre-initialized so connected players can bid.
        expect(state.rounds).toHaveLength(1);
        expect(state.rounds[0]).toEqual([null, null, null]);
    });

    it("skull king: lobby status is the current round", () => {
        const app = gameAppByGameId(GAME_ID_SKULL_KING)!;
        const state = app.createInitialState(PLAYERS) as SkullKingGameState;
        expect(app.statusText(state)).toBe("Раунд 1");
        expect(app.statusText({ ...state, currentRound: 7 })).toBe("Раунд 7");
    });

    it("iaww: a created table starts scoring with entries aligned to the players", () => {
        const state = gameAppByGameId(GAME_ID_IAWW)!.createInitialState(PLAYERS);
        if (!isIawwState(state)) throw new Error("expected an IAWW state");
        expect(state.phase).toBe("scoring");
        expect(state.players).toEqual(PLAYERS);
        expect(state.entries.map((e) => e.playerId)).toEqual(PLAYERS.map((p) => p.id));
        for (const entry of state.entries) {
            expect(entry.done).toBe(false);
            expect(entry.directVp).toBeNull();
            expect(entry.cells).toEqual([]);
        }
    });

    it("iaww: lobby status counts finished columns", () => {
        const app = gameAppByGameId(GAME_ID_IAWW)!;
        const state = app.createInitialState(PLAYERS) as IawwGameState;
        expect(app.statusText(state)).toBe("Готовы 0/3");
        const done = { ...state, entries: state.entries.map((e, i) => ({ ...e, done: i < 2 })) };
        expect(app.statusText(done)).toBe("Готовы 2/3");
    });

    it("unknown game ids resolve to no app", () => {
        expect(gameAppByGameId(pid("gUnknown"))).toBeUndefined();
        expect(gameAppByGameId(null)).toBeUndefined();
    });
});

describe("mergeTableStates", () => {
    const sk = (phase: SkullKingGameState["phase"], currentRound: number): SkullKingGameState => ({
        phase,
        players: PLAYERS.slice(0, 2),
        currentRound,
        currentPlayerIndex: 0,
        rounds: [],
    });

    it("dispatches by the table's game: a same-field race keeps the editor's value", () => {
        const before = sk("waiting-for-bids", 2);
        const local = { ...before, phase: "bid-review" as const };
        const fresh = sk("result-entry", 2);
        const merged = mergeTableStates(GAME_ID_SKULL_KING, before, local, fresh) as SkullKingGameState;
        expect(merged.phase).toBe("bid-review");
    });

    it("a field only the server touched keeps the server's value", () => {
        const before = sk("waiting-for-bids", 2);
        const local = { ...before, phase: "bid-review" as const };
        const fresh = sk("waiting-for-bids", 3);
        const merged = mergeTableStates(GAME_ID_SKULL_KING, before, local, fresh) as SkullKingGameState;
        expect(merged.phase).toBe("bid-review");
        expect(merged.currentRound).toBe(3);
    });

    it("falls back to the fresh state for unknown games or mismatched shapes", () => {
        const before = sk("waiting-for-bids", 2);
        const local = { ...before, phase: "bid-review" as const };
        const fresh = sk("result-entry", 3);
        expect(mergeTableStates(pid("gUnknown"), before, local, fresh)).toBe(fresh);
    });
});
