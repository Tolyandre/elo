// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { Tournament, TournamentPlan, TournamentInput } from "../app/api";

// The edit page gates the shape picker's start button on the registration
// editor's draft: a plan is computed from the SAVED tournament, so starting
// with unsaved changes would silently drop them (e.g. a just-added
// participant). The harness here mirrors the page wiring — one shared
// «unsaved» flag and a refetch that applies the saved body as the new
// snapshot, like the real invalidate() round-trip.
const mocks = vi.hoisted(() => ({
    savedBody: null as TournamentInput | null,
    updateCalls: [] as { id: Base58ID; body: TournamentInput }[],
}));

vi.mock("@/app/api", () => ({
    updateTournamentPromise: vi.fn(async (id: Base58ID, body: TournamentInput) => {
        mocks.savedBody = body;
        mocks.updateCalls.push({ id, body });
    }),
    startTournamentPromise: vi.fn(async () => {}),
    getTournamentBracketPlansPromise: vi.fn(async () => ({
        plans: [plan],
        truncated: false,
        cap: 50,
        facets: {
            eliminations: ["single"],
            round_counts: [2],
            has_byes: false,
            all_byes: false,
            first_shapes: ["2+2"],
        },
    })),
}));

vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: [], invalidate: () => {} }),
}));

vi.mock("@/components/player-multi-select", () => ({
    PlayerMultiSelect: ({ value, onChange }: { value: Base58ID[]; onChange: (ids: Base58ID[]) => void }) => (
        <button type="button" onClick={() => onChange([...value, "p-new" as Base58ID])}>
            + участник
        </button>
    ),
}));

vi.mock("@/components/game-combobox", () => ({
    GameCombobox: ({ onChange }: { onChange: (id?: Base58ID) => void }) => (
        <button type="button" onClick={() => onChange("g-new" as Base58ID)}>+ игра</button>
    ),
}));

// Two first-round tables of two; each winner goes to the grand final.
const plan: TournamentPlan = {
    elimination: "single",
    rounds: [
        {
            track: "winners",
            index: 1,
            promote: 1,
            slots: [
                { seat_count: 2, seats: [{ kind: "draw" }, { kind: "draw" }] },
                { seat_count: 2, seats: [{ kind: "draw" }, { kind: "draw" }] },
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

const savedTournament: Tournament = {
    id: "t-1" as Base58ID,
    name: "Кубок",
    status: "registration",
    elimination: null,
    grand_final_deadline: null,
    games: [{ game_id: "g-1" as Base58ID, min_players: 2, max_players: 4 }],
    participant_ids: ["p-1" as Base58ID, "p-2" as Base58ID],
};

// jsdom lacks the layout APIs Radix Select touches while opening.
Element.prototype.scrollIntoView = () => {};
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const { RegistrationEditor } = await import("../app/tournaments/edit/registration-editor");
const { ShapePicker } = await import("../app/tournaments/edit/shape-picker");

function Harness({ snapshot }: { snapshot: Tournament }) {
    const [tournament, setTournament] = useState(snapshot);
    const [unsaved, setUnsaved] = useState(false);
    // Stand-in for the page's invalidate(): the mocked PUT captured the saved
    // body; the refetched snapshot is that body applied to the server record.
    const refetch = () => {
        const b = mocks.savedBody;
        if (!b) return;
        setTournament({
            ...snapshot,
            name: b.name,
            grand_final_deadline: b.grand_final_deadline ?? null,
            games: b.games ?? [],
            participant_ids: b.participant_ids,
        });
    };
    return (
        <>
            <RegistrationEditor tournament={tournament} onSaved={refetch} onUnsavedChange={setUnsaved} />
            <ShapePicker tournament={tournament} unsavedChanges={unsaved} onStarted={() => {}} />
        </>
    );
}

function renderHarness() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<Harness snapshot={savedTournament} />);
    });
    return {
        text: () => document.body.textContent ?? "",
        button: (label: string) =>
            [...document.body.querySelectorAll("button")].find((b) => b.textContent === label),
        startButton: () => {
            const b = [...document.body.querySelectorAll("button")].find(
                (b) => b.textContent === "Начать турнир",
            );
            if (!b) throw new Error("start button not rendered");
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

/** Picks the first plan in the Radix select via the keyboard path. */
async function selectFirstPlan() {
    const trigger = document.body.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
    if (!trigger) throw new Error("select trigger not found");
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const option = document.body.querySelector<HTMLElement>('[role="option"]');
    if (!option) throw new Error("plan option not found");
    await act(async () => {
        option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
}

describe("tournament edit: start gated on unsaved changes", () => {
    it("allows starting a saved configuration", async () => {
        const view = renderHarness();
        await act(async () => {}); // flush the plans fetch

        await selectFirstPlan();
        expect(view.startButton().disabled).toBe(false);
        expect(view.text()).not.toContain("несохранённые изменения");

        await click(view.startButton());
        expect(view.text()).toContain("Начать турнир?");
        view.unmount();
    });

    it("blocks start while the draft differs, releases after a save", async () => {
        const view = renderHarness();
        await act(async () => {});
        await selectFirstPlan();

        // Add a participant in the draft — the plan list still shows the
        // saved configuration, so the start must be blocked with a hint.
        await click(view.button("+ участник")!);
        expect(view.text()).toContain("Есть несохранённые изменения конфигурации");
        expect(view.startButton().disabled).toBe(true);

        // Saving persists the draft (the new participant included) and the
        // refetched snapshot releases the button for a fresh plan choice.
        await click(view.button("Сохранить")!);
        expect(mocks.updateCalls).toEqual([
            {
                id: "t-1",
                body: expect.objectContaining({
                    participant_ids: ["p-1", "p-2", "p-new"],
                }),
            },
        ]);
        expect(view.text()).not.toContain("несохранённые изменения");

        await selectFirstPlan();
        expect(view.startButton().disabled).toBe(false);
        view.unmount();
    });

    it("blocks start on any unsaved field, not just participants", async () => {
        const view = renderHarness();
        await act(async () => {});
        await selectFirstPlan();

        const nameInput = document.body.querySelector<HTMLInputElement>("#t-name")!;
        const setValue = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
        )!.set!;
        await act(async () => {
            setValue.call(nameInput, "Кубок-2");
            nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(view.text()).toContain("Есть несохранённые изменения конфигурации");
        expect(view.startButton().disabled).toBe(true);
        view.unmount();
    });
});
