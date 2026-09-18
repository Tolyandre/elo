// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { TournamentPlan } from "../app/api";

const { PlanBracketPreview } = await import("../app/tournaments/plan-bracket-preview");

// Two first-round tables of two; each winner goes to the grand final.
const plan: TournamentPlan = {
    elimination: "single",
    rounds: [
        {
            track: "winners",
            index: 1,
            promote: 1,
            slots: [
                {
                    seat_count: 2,
                    seats: [
                        { kind: "draw" },
                        { kind: "draw" },
                    ],
                },
                {
                    seat_count: 2,
                    seats: [
                        { kind: "draw" },
                        { kind: "draw" },
                    ],
                },
            ],
        },
        {
            track: "final",
            index: 1,
            promote: 1,
            slots: [
                {
                    seat_count: 2,
                    seats: [
                        { kind: "source", source_slot: 0, source_place: 1 },
                        { kind: "source", source_slot: 1, source_place: 1 },
                    ],
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

describe("PlanBracketPreview", () => {
    it("renders a column per round with the promotion count", () => {
        const container = render(<PlanBracketPreview plan={plan} />);
        const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
        expect(headings).toEqual(["Тур 1 → 1", "Финал → 1"]);
    });

    it("renders seat dots per table", () => {
        const container = render(<PlanBracketPreview plan={plan} />);
        const nodes = [...container.querySelectorAll("[data-bracket-slot]")];
        expect(nodes.length).toBe(3);
        const dots = nodes.map((n) => n.querySelectorAll("[data-bracket-seat]").length);
        expect(dots).toEqual([2, 2, 2]);
    });

    it("draws one line per sourced seat", () => {
        const container = render(<PlanBracketPreview plan={plan} />);
        expect(container.querySelectorAll("svg path").length).toBe(2);
    });

    it("shows the double-elimination tracks as stacked bands", () => {
        const doublePlan: TournamentPlan = {
            elimination: "double",
            rounds: [
                {
                    track: "winners", index: 1, promote: 2,
                    slots: [{ seat_count: 3, seats: [{ kind: "draw" }, { kind: "draw" }, { kind: "draw" }] }],
                },
                {
                    track: "losers", index: 1, promote: 1,
                    slots: [{ seat_count: 2, seats: [{ kind: "source", source_slot: 0, source_place: 3 }, { kind: "bye" }] }],
                },
                {
                    track: "final", index: 1, promote: 1,
                    slots: [{ seat_count: 3, seats: [{ kind: "bye" }, { kind: "source", source_slot: 0, source_place: 1 }, { kind: "source", source_slot: 1, source_place: 1 }] }],
                },
            ],
        };
        const container = render(<PlanBracketPreview plan={doublePlan} />);
        const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
        expect(headings).toEqual(["Победители", "Верх 1 → 2", "Проигравшие", "Низ 1 → 1", "Финал → 1"]);
    });
});
