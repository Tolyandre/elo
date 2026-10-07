// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { BracketPlanFilters, Tournament, TournamentPlan } from "../app/api";

// The shape picker's chip rows travel as query parameters: the advance chips
// multi-select the per-round advancement counts, the rematch chips toggle
// between mutually exclusive with/without (clicking the active one releases
// the filter). The mock captures every query so the assertions read the wire
// shape the server sees.
const mocks = vi.hoisted(() => ({
    queries: [] as (BracketPlanFilters | undefined)[],
}));

vi.mock("@/app/api", () => ({
    getTournamentBracketPlansPromise: vi.fn(async (_id: Base58ID, filters?: BracketPlanFilters) => {
        mocks.queries.push(filters);
        return { plans: [plan], truncated: false, cap: 50, facets };
    }),
    startTournamentPromise: vi.fn(async () => {}),
}));

vi.mock("../app/tournaments/plan-bracket-preview", () => ({
    PlanBracketPreview: () => <div>preview</div>,
}));

const facets = {
    eliminations: ["single"],
    round_counts: [2],
    has_byes: false,
    all_byes: false,
    first_shapes: ["2+2"],
    advances: [1, 2],
    has_rematches: true,
    all_rematches: false,
};

const plan: TournamentPlan = {
    elimination: "single",
    rounds: [
        {
            track: "winners",
            index: 1,
            advance: 1,
            slots: [
                { seat_count: 2, seats: [{ kind: "draw" }, { kind: "draw" }] },
                { seat_count: 2, seats: [{ kind: "draw" }, { kind: "draw" }] },
            ],
        },
        {
            track: "final",
            index: 1,
            advance: 1,
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

const tournament: Tournament = {
    id: "t-1" as Base58ID,
    club_id: "c-blue" as Base58ID,
    name: "Кубок",
    status: "registration",
    elimination: null,
    grand_final_deadline: null,
    games: [{ game_id: "g-1" as Base58ID, min_players: 2, max_players: 4 }],
    participant_ids: ["p-1" as Base58ID, "p-2" as Base58ID, "p-3" as Base58ID, "p-4" as Base58ID],
};

// jsdom lacks the layout APIs Radix Select touches while opening.
Element.prototype.scrollIntoView = () => {};
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const { ShapePicker } = await import("../app/tournaments/edit/shape-picker");

function renderPicker() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<ShapePicker tournament={tournament} onStarted={() => {}} />);
    });
    return {
        text: () => document.body.textContent ?? "",
        button: (label: string) => {
            const b = [...document.body.querySelectorAll("button")].find(
                (b) => b.textContent === label,
            );
            if (!b) throw new Error(`button «${label}» not rendered`);
            return b as HTMLButtonElement;
        },
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

async function click(button: HTMLButtonElement) {
    await act(async () => {
        button.click();
    });
}

describe("shape picker: advance and rematch chips", () => {
    it("renders the new rows from facets and sends the selection as query params", async () => {
        const view = renderPicker();
        await act(async () => {}); // flush the plans fetch

        expect(view.text()).toContain("Продвижение");
        expect(view.text()).toContain("Повторы");
        expect(mocks.queries.at(-1)).toEqual({});

        // The advance chips multi-select the per-round counts.
        await click(view.button("По 2"));
        expect(mocks.queries.at(-1)?.advances).toEqual([2]);
        await click(view.button("По 1"));
        expect(mocks.queries.at(-1)?.advances).toEqual([2, 1]);
        await click(view.button("По 1"));
        expect(mocks.queries.at(-1)?.advances).toEqual([2]);
        await click(view.button("По 2"));
        expect(mocks.queries.at(-1)?.advances).toBeUndefined();

        // The rematch chips are mutually exclusive; the active one releases.
        await click(view.button("Без повторов"));
        expect(mocks.queries.at(-1)?.rematches).toBe("without");
        await click(view.button("С повторами"));
        expect(mocks.queries.at(-1)?.rematches).toBe("with");
        expect(mocks.queries.at(-1)?.advances).toBeUndefined();
        await click(view.button("С повторами"));
        expect(mocks.queries.at(-1)?.rematches).toBeUndefined();
        view.unmount();
    });
});
