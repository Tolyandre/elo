// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { Bracket } from "../app/api";

// Names resolve through the shared players/games contexts; pin both.
vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: () => ({
        playerMap: new Map([
            ["p1", { id: "p1", name: "Алиса" }],
            ["p2", { id: "p2", name: "Борис" }],
        ]),
        playerDisplayName: (p: { name: string }) => p.name,
    }),
}));
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: [{ id: "g1", name: "Флажки" }] }),
}));

const { BracketView } = await import("../app/tournaments/view/bracket-view");

const bracket: Bracket = {
    tournament_id: "t1" as Base58ID,
    status: "running",
    elimination: "single",
    rounds: [
        {
            track: "winners",
            index: 1,
            slots: [
                {
                    id: "s1" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 2,
                    status: "playing",
                    seats: [
                        { position: 1, player_id: "p1" as Base58ID },
                        { position: 2, player_id: "p2" as Base58ID },
                    ],
                    matches: [{ match_id: "m1" as Base58ID }],
                    standings: [
                        { player_id: "p1" as Base58ID, points: 2, place: 1, promoted: true },
                        { player_id: "p2" as Base58ID, points: 1, place: 2, promoted: false },
                    ],
                },
            ],
        },
        {
            track: "final",
            index: 1,
            slots: [
                {
                    id: "s2" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                    status: "waiting",
                    seats: [
                        { position: 1, source_slot_id: "s1" as Base58ID, source_place: 1 },
                        { position: 2, source_slot_id: "s1" as Base58ID, source_place: 2 },
                    ],
                    matches: [],
                    standings: [],
                },
            ],
        },
    ],
};

function render(jsx: React.ReactElement) {
    const container = document.createElement("div");
    act(() => {
        createRoot(container).render(jsx);
    });
    return container;
}

describe("BracketView", () => {
    it("renders a column per round with elimination-aware titles", () => {
        const container = render(<BracketView bracket={bracket} />);
        const headings = [...container.querySelectorAll("h3")].map((h) => h.textContent);
        expect(headings).toEqual(["Тур 1", "Финал"]);
    });

    it("renders slot cards with game name, status and seated players", () => {
        const container = render(<BracketView bracket={bracket} />);
        expect(container.textContent).toContain("Стол 1");
        expect(container.textContent).toContain("Флажки");
        expect(container.textContent).toContain("Играет");
        expect(container.textContent).toContain("Алиса");
        expect(container.textContent).toContain("Борис");
        expect(container.textContent).toContain("партий: 1");
    });

    it("marks unresolved seats as placeholders carrying their provenance as a hint", () => {
        const container = render(<BracketView bracket={bracket} />);
        expect(container.textContent).not.toContain("из стола 1, место 1");
        const seats = [...container.querySelectorAll('[data-bracket-slot="s2"] li')];
        expect(seats.map((li) => li.getAttribute("title"))).toEqual([
            "из стола 1, место 1",
            "из стола 1, место 2",
        ]);
        expect(container.textContent).toContain("Ожидает");
    });

    it("draws one promotion line per sourced seat", () => {
        const container = render(<BracketView bracket={bracket} />);
        const paths = [...container.querySelectorAll("svg path")];
        expect(paths.length).toBe(2);
    });

    it("renders live standings with points and the promoted set", () => {
        const container = render(<BracketView bracket={bracket} />);
        const rows = [...container.querySelectorAll("li")].map((li) => li.textContent);
        expect(rows.some((r) => r?.includes("Алиса") && r.includes("+2"))).toBe(true);
        expect(rows.some((r) => r?.includes("Борис") && r.includes("1"))).toBe(true);
    });
});
