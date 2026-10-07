// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom gaps cmdk relies on: height tracking (ResizeObserver) and
// scroll-into-view of the selected item.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Club, Player } from "@/app/api";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    players: [] as { id: string; name: string; geologist_name?: string | null }[],
    clubs: [] as { id: string; name: string; geologist_name?: string | null; player_ids: string[] }[],
    myPlayerId: undefined as string | undefined,
    recentPlayerIds: [] as string[],
}));

vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: () => ({
        players: state.players,
        playerDisplayName: (p: { name: string }) => p.name,
    }),
}));
vi.mock("@/app/clubsContext", () => ({
    useClubs: () => ({
        clubs: state.clubs,
        clubDisplayName: (c: { name: string }) => c.name,
        clubsForPlayer: (playerId: string) => state.clubs.filter((c) => c.player_ids.includes(playerId)),
    }),
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ playerId: state.myPlayerId }),
}));
vi.mock("@/app/players/useRecentPlayerIds", () => ({
    useRecentPlayerIds: () => state.recentPlayerIds,
}));
vi.mock("@/hooks/use-is-mobile", () => ({
    default: () => ({ isMobile: false }),
}));
// Render the picker content inline instead of through a Radix portal.
vi.mock("@/components/responsive-command-popover", () => ({
    ResponsiveCommandPopover: ({ trigger, content }: { trigger: ReactNode; content: ReactNode }) => (
        <>
            {trigger}
            <div data-testid="popover-content">{content}</div>
        </>
    ),
}));

import { PlayerCombobox } from "@/components/player-combobox";

const player = (id: string, name: string) => ({ id, name, geologist_name: null }) as unknown as Player;
const club = (id: string, name: string, playerIds: string[]) =>
    ({ id, name, geologist_name: null, player_ids: playerIds }) as unknown as Club;

// Bob and Alice are in the current user's club «Альфа», Carol in the other
// club «Бета», Dave is club-less. Недавние = Dave, Alice (Dave also belongs
// to «Без клуба», Alice to «Альфа» — both are expected to repeat).
const alice = player("1", "Alice");
const bob = player("2", "Bob");
const carol = player("3", "Carol");
const dave = player("4", "Dave");
const alpha = club("a", "Альфа", ["1", "2"]);
const beta = club("b", "Бета", ["3"]);

let container: HTMLDivElement;
let cleanup: () => void;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<PlayerCombobox />);
    });
    return () =>
        act(() => {
            root.unmount();
            container.remove();
        });
}

function type(query: string) {
    const input = container.querySelector<HTMLInputElement>("input[cmdk-input]")!;
    // React tracks controlled-input values through its own setter; assigning
    // via the prototype setter is what makes the synthetic onChange fire.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
        setValue.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Group elements cmdk has not hidden (their players match the search). */
function visibleGroups(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[cmdk-group]")).filter(
        (g) => !g.hasAttribute("hidden"),
    );
}

/** Visible group headings, in DOM order. */
function headings(): string[] {
    return visibleGroups().map((g) => g.querySelector("[cmdk-group-heading]")?.textContent ?? "");
}

/** Visible items, in DOM order (cmdk re-sorts matches by relevance). */
function itemTexts(): string[] {
    return visibleGroups().flatMap((g) =>
        Array.from(g.querySelectorAll("[cmdk-item]")).map((i) => i.textContent ?? ""),
    );
}

describe("PlayerCombobox search sections", () => {
    beforeEach(() => {
        state.players = [alice, bob, carol, dave];
        state.clubs = [beta, alpha];
        state.myPlayerId = "2";
        state.recentPlayerIds = ["4", "1"];
        cleanup = mount();
    });
    afterEach(() => {
        cleanup();
    });

    it("shows grouped sections in order while searching", () => {
        type("a"); // Alice, Carol, Dave match

        expect(headings()).toEqual(["Недавние", "Альфа", "Бета", "Без клуба"]);
        // Within a section cmdk orders by match score: Alice prefix-matches.
        expect(itemTexts()).toEqual(["Alice", "Dave", "Alice", "Carol", "Dave"]);
    });

    it("hides sections without matching players", () => {
        type("carol");

        expect(headings()).toEqual(["Бета"]);
        expect(itemTexts()).toEqual(["Carol"]);
    });

    it("repeats a player across the sections it belongs to", () => {
        type("alice"); // recent + in the user's club

        expect(headings()).toEqual(["Недавние", "Альфа"]);
        expect(itemTexts()).toEqual(["Alice", "Alice"]);
    });

    it("shows the empty state when nothing matches", () => {
        type("zzz");

        expect(headings()).toEqual([]);
        expect(container.textContent).toContain("Игрок не найден.");
    });

    it("keeps the tabbed browsing view when not searching", () => {
        expect(container.textContent).toContain("Недавние");
        expect(container.textContent).toContain("Альфа");
        expect(container.textContent).toContain("Другие");
        // Browsing shows the active tab's options without section headings.
        expect(headings()).toEqual([""]);
        expect(itemTexts()).toEqual(["Dave", "Alice"]); // the Недавние tab, recency order
    });
});
