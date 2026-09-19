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
            ["p3", { id: "p3", name: "Вера" }],
            ["p4", { id: "p4", name: "Гриша" }],
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
        expect(container.textContent).toContain("Партий: 1");
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

    it("anchors a completed slot's lines at standings rows and drops provenance text", () => {
        // A played-through successor slot: its seats are resolved and its
        // standings list shows the names, so the provenance rows would be
        // noise — the lines point straight at the name rows.
        const completed: Bracket = {
            ...bracket,
            rounds: [
                bracket.rounds[0],
                {
                    track: "final",
                    index: 1,
                    slots: [
                        {
                            id: "s4" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                            status: "completed",
                            seats: [
                                { position: 1, source_slot_id: "s1" as Base58ID, source_place: 1, player_id: "p1" as Base58ID },
                                { position: 2, source_slot_id: "s1" as Base58ID, source_place: 2, player_id: "p2" as Base58ID },
                            ],
                            matches: [{ match_id: "m2" as Base58ID }],
                            standings: [
                                { player_id: "p1" as Base58ID, points: 3, place: 1, promoted: true },
                                { player_id: "p2" as Base58ID, points: 1, place: 2, promoted: false },
                            ],
                        },
                    ],
                },
            ],
        };
        const container = render(<BracketView bracket={completed} />);
        expect(container.textContent).not.toContain("из стола");
        expect(container.querySelectorAll("svg path").length).toBe(2);
    });

    it("renders live standings with points and the promoted set", () => {
        const container = render(<BracketView bracket={bracket} />);
        const rows = [...container.querySelectorAll("li")].map((li) => li.textContent);
        expect(rows.some((r) => r?.includes("Алиса") && r.includes("+2"))).toBe(true);
        expect(rows.some((r) => r?.includes("Борис") && r.includes("1"))).toBe(true);
    });

    it("styles the WB→LB crossings as dashed drop curves, other lines solid", () => {
        const doubleElim: Bracket = {
            tournament_id: "t1" as Base58ID,
            status: "running",
            elimination: "double",
            rounds: [
                {
                    track: "winners",
                    index: 1,
                    slots: [
                        {
                            id: "w1" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                            status: "playing",
                            seats: [
                                { position: 1, player_id: "p1" as Base58ID },
                                { position: 2, player_id: "p2" as Base58ID },
                            ],
                            matches: [],
                            standings: [],
                        },
                        {
                            id: "w2" as Base58ID, game_id: "g1" as Base58ID, position: 2, promote: 1,
                            status: "playing",
                            seats: [
                                { position: 1, player_id: "p3" as Base58ID },
                                { position: 2, player_id: "p4" as Base58ID },
                            ],
                            matches: [],
                            standings: [],
                        },
                    ],
                },
                {
                    track: "losers",
                    index: 1,
                    slots: [
                        {
                            id: "l1" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                            status: "waiting",
                            seats: [
                                { position: 1, source_slot_id: "w1" as Base58ID, source_place: 2 },
                                { position: 2, source_slot_id: "w2" as Base58ID, source_place: 2 },
                            ],
                            matches: [],
                            standings: [],
                        },
                    ],
                },
                {
                    track: "final",
                    index: 1,
                    slots: [
                        {
                            id: "f1" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                            status: "waiting",
                            seats: [
                                { position: 1, source_slot_id: "w1" as Base58ID, source_place: 1 },
                                { position: 2, source_slot_id: "l1" as Base58ID, source_place: 1 },
                            ],
                            matches: [],
                            standings: [],
                        },
                    ],
                },
            ],
        };
        const container = render(<BracketView bracket={doubleElim} />);
        const paths = [...container.querySelectorAll("svg path")];
        expect(paths.length).toBe(4);
        const dashed = paths.filter((p) => p.getAttribute("stroke-dasharray") != null);
        // Exactly the two WB→LB seats of the losers slot drop as curves.
        expect(dashed.map((p) => p.getAttribute("data-connector-key"))).toEqual(["l1:1", "l1:2"]);
    });
});

describe("BracketView click-to-trace", () => {
    function click(el: Element) {
        act(() => {
            el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    const resolved: Bracket = {
        ...bracket,
        rounds: [
            bracket.rounds[0],
            {
                track: "final",
                index: 1,
                slots: [
                    {
                        id: "s4" as Base58ID, game_id: "g1" as Base58ID, position: 1, promote: 1,
                        status: "completed",
                        seats: [
                            { position: 1, source_slot_id: "s1" as Base58ID, source_place: 1, player_id: "p1" as Base58ID },
                            { position: 2, source_slot_id: "s1" as Base58ID, source_place: 2, player_id: "p2" as Base58ID },
                        ],
                        matches: [{ match_id: "m2" as Base58ID }],
                        standings: [
                            { player_id: "p1" as Base58ID, points: 3, place: 1, promoted: true },
                            { player_id: "p2" as Base58ID, points: 1, place: 2, promoted: false },
                        ],
                    },
                ],
            },
        ],
    };

    it("spotlights a player's rows and lines across the bracket and dims the rest", () => {
        const container = render(<BracketView bracket={resolved} />);
        click(container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="2"]')!);

        // Борис: his standings row in both slots is marked (the seat lists
        // are hidden where standings show the names).
        const highlighted = [...container.querySelectorAll("[data-highlighted]")];
        expect(highlighted.length).toBe(2);
        expect(container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="2"]')!.getAttribute("data-highlighted")).toBe("true");
        expect(container.querySelector('[data-bracket-slot="s4"] [data-bracket-standing="2"]')!.getAttribute("data-highlighted")).toBe("true");
        expect(container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="1"]')!.getAttribute("data-highlighted")).toBeNull();

        // His line stays at full strength, Алиса's dims.
        const p2Line = container.querySelector('[data-connector-key="s4:2"]')!;
        const p1Line = container.querySelector('[data-connector-key="s4:1"]')!;
        expect(p2Line.getAttribute("opacity")).toBe("1");
        expect(p1Line.getAttribute("opacity")).toBe("0.15");

        // Clicking the same row again clears the trace.
        click(container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="2"]')!);
        expect(container.querySelectorAll("[data-highlighted]").length).toBe(0);
        expect(container.querySelector('[data-connector-key="s4:1"]')!.getAttribute("opacity")).toBe("1");
    });

    it("spotlights an unresolved seat's provenance: its line and the source row", () => {
        const container = render(<BracketView bracket={bracket} />);
        click(container.querySelector('[data-bracket-slot="s2"] [data-bracket-seat="1"]')!);

        const seat = container.querySelector('[data-bracket-slot="s2"] [data-bracket-seat="1"]')!;
        expect(seat.getAttribute("data-highlighted")).toBe("true");
        // The provenance row (место 1 of the source slot) is marked too.
        expect(
            container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="1"]')!.getAttribute("data-highlighted"),
        ).toBe("true");
        expect(container.querySelector('[data-bracket-slot="s1"] [data-bracket-standing="2"]')!.getAttribute("data-highlighted")).toBeNull();

        expect(container.querySelector('[data-connector-key="s2:1"]')!.getAttribute("opacity")).toBe("1");
        expect(container.querySelector('[data-connector-key="s2:2"]')!.getAttribute("opacity")).toBe("0.15");
    });
});
