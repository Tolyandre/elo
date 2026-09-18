// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { Bracket } from "../app/api";
import { renderHook } from "./render-hook";

// useTournamentSlotFit reads the preloaded tournament list from the
// TournamentsProvider context and fetches each running tournament's bracket;
// both sides are pinned here.
const runningTournament = {
    id: "t1" as Base58ID,
    name: "Кубок",
    status: "running" as const,
    elimination: "single" as const,
    games: [],
};
const registrationTournament = {
    id: "t2" as Base58ID,
    name: "Ранний",
    status: "registration" as const,
    elimination: "single" as const,
    games: [],
};

vi.mock("@/app/tournaments/tournamentsContext", () => ({
    useTournaments: () => ({
        tournaments: [registrationTournament, runningTournament],
        activeTournaments: [registrationTournament, runningTournament],
        invalidate: () => {},
    }),
}));

const brackets: Record<string, Bracket> = {
    t1: {
        tournament_id: "t1" as Base58ID,
        status: "running",
        elimination: "single",
        rounds: [
            {
                track: "winners",
                index: 1,
                slots: [
                    {
                        id: "s1" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                        status: "playing",
                        seats: [
                            { position: 1, player_id: "p1" as Base58ID },
                            { position: 2, player_id: "p2" as Base58ID },
                        ],
                        matches: [],
                        standings: [],
                    },
                    {
                        id: "s2" as Base58ID, game_id: "g2" as Base58ID, position: 2, promote: 1,
                        status: "waiting",
                        seats: [
                            { position: 1, source_slot_id: "s1" as Base58ID, source_place: 1 },
                            { position: 2 },
                        ],
                        matches: [],
                        standings: [],
                    },
                ],
            },
        ],
    },
};

const getBracket = vi.fn(async (id: Base58ID) => brackets[id as string]);
vi.mock("@/app/api", () => ({
    getTournamentBracketPromise: (id: Base58ID) => getBracket(id),
}));

const { useTournamentSlotFit } = await import("../hooks/useTournamentSlotFit");

const p = (id: string) => id as Base58ID;
const g = (id: string) => id as Base58ID;

async function renderFit(playerIds: Base58ID[], gameId?: Base58ID) {
    const handle = renderHook(() => useTournamentSlotFit(playerIds, gameId));
    // Flush the bracket fetches into state.
    await act(async () => {});
    return handle;
}

describe("useTournamentSlotFit", () => {
    it("fits when the roster and game exactly match a playing slot", async () => {
        const { current } = await renderFit([p("p1"), p("p2")], g("g1"));
        expect(current.value.fits).toBe(true);
        expect(current.value.tournamentNames).toEqual(["Кубок"]);
    });

    it("does not fit a different roster", async () => {
        const { current } = await renderFit([p("p1"), p("p9")], g("g1"));
        expect(current.value.fits).toBe(false);
    });

    it("does not fit a different game", async () => {
        const { current } = await renderFit([p("p1"), p("p2")], g("g3"));
        expect(current.value.fits).toBe(false);
    });

    it("fetches brackets of running tournaments only", async () => {
        getBracket.mockClear();
        await renderFit([p("p1"), p("p2")], g("g1"));
        expect(getBracket).toHaveBeenCalledTimes(1);
        expect(getBracket).toHaveBeenCalledWith("t1");
    });

    it("no fit without a game or without players", async () => {
        const { current } = await renderFit([], g("g1"));
        expect(current.value.fits).toBe(false);
        const { current: withGameOnly } = await renderFit([p("p1")], undefined);
        expect(withGameOnly.value.fits).toBe(false);
    });
});
