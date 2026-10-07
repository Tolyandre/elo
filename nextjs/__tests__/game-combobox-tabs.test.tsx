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
import type { GameListItem } from "@/app/api";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    games: [] as GameListItem[],
    matches: [] as { game_id: string; date: string; score: Record<string, number> }[],
    playerId: undefined as string | undefined,
    favorites: { recent: [] as string[], popular: [] as string[] },
    pendingGames: [] as { clientId: string; name: string; meta?: { gameMode?: string } }[],
}));

vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: state.games }),
}));
vi.mock("@/app/matches/MatchesContext", () => ({
    useMatches: () => ({ matches: state.matches }),
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ playerId: state.playerId }),
}));
vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ pendingGames: state.pendingGames }),
}));
vi.mock("@/app/useFavoriteGames", () => ({
    useFavoriteGames: () => state.favorites,
}));
vi.mock("@/app/tagsContext", () => ({
    useTags: () => ({ tags: [] }),
}));
// game-suggestions imports the API client (env-var gated) — not under test.
vi.mock("@/components/game-suggestions", () => ({
    useGameSuggestions: () => [],
    GameSuggestionChips: () => null,
    AcceptedMetaLine: () => null,
    suggestionMeta: (s: unknown) => s,
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

import { GameCombobox } from "@/components/game-combobox";

const game = (id: string, name: string, totalMatches = 0): GameListItem =>
    ({ id, name, alias: null, name_en: null, name_ru: null, total_matches: totalMatches, last_played_order: 0, tags: [] }) as unknown as GameListItem;

// Chess is the current player's latest game, Checkers their second; Catan is
// the popular one; Azul rounds out the catalogue.
const chess = game("g1", "Chess", 3);
const checkers = game("g2", "Checkers", 2);
const catan = game("g3", "Catan", 10);
const azul = game("g4", "Azul", 1);

let container: HTMLDivElement;
let cleanup: () => void;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<GameCombobox />);
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

/** Group elements cmdk has not hidden (their games match the search). */
function visibleGroups(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[cmdk-group]")).filter(
        (g) => !g.hasAttribute("hidden"),
    );
}

/** Visible group headings, in DOM order. */
function headings(): string[] {
    return visibleGroups().map((g) => g.querySelector("[cmdk-group-heading]")?.textContent ?? "");
}

/** Visible items, in DOM order. */
function itemTexts(): string[] {
    return visibleGroups().flatMap((g) =>
        Array.from(g.querySelectorAll("[cmdk-item]")).map((i) => i.textContent ?? ""),
    );
}

function tabLabels(): string[] {
    return Array.from(container.querySelectorAll("[role=tab]")).map((t) => t.textContent ?? "");
}

describe("GameCombobox tabs", () => {
    beforeEach(() => {
        state.games = [chess, checkers, catan, azul];
        state.matches = [];
        state.playerId = "me";
        state.favorites = { recent: ["g1", "g2"], popular: ["g3"] };
        state.pendingGames = [];
        cleanup = mount();
    });
    afterEach(() => {
        cleanup();
    });

    it("browses the «Избранные» tab first, with its two sections", () => {
        expect(tabLabels()).toEqual(["Избранные", "Остальные"]);
        // The favorites tab's sections stay headed: Недавние, then Популярные.
        expect(headings()).toEqual(["Недавние", "Популярные"]);
        expect(itemTexts()).toEqual(["Chess", "Checkers", "Catan"]);
    });

    it("switches to the «Остальные» tab with the rest alphabetically", () => {
        const otherTab = Array.from(container.querySelectorAll<HTMLButtonElement>("[role=tab]")).find(
            (t) => t.textContent === "Остальные",
        )!;
        // Radix TabsTrigger activates on mousedown, not click.
        act(() => {
            otherTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        expect(headings()).toEqual([""]);
        expect(itemTexts()).toEqual(["Azul"]);
    });

    it("hides the tab strip and shows flat sections while searching", () => {
        type("chec"); // «Checkers» in «Недавние» only (cmdk matches fuzzily)

        expect(tabLabels()).toEqual([]);
        expect(headings()).toEqual(["Недавние"]);
        expect(itemTexts()).toEqual(["Checkers"]);
    });

    it("hides sections without matching games", () => {
        type("azul");

        expect(headings()).toEqual(["Остальные"]);
        expect(itemTexts()).toEqual(["Azul"]);
    });

    it("offers creating a new game from the empty state", () => {
        type("zzz");

        expect(headings()).toEqual([]);
        expect(container.textContent).toContain('Создать "zzz"');
    });

    it("keeps the offline pending games on top of the browse view", () => {
        state.pendingGames = [{ clientId: "c1", name: "Homebrew" }];
        cleanup();
        cleanup = mount();

        expect(itemTexts()[0]).toBe("Homebrew (офлайн)");
        expect(headings()[0]).toBe("Офлайн (не сохранено)");
    });

    it("shows a flat alphabetical list without the tab strip when there are no favorites", () => {
        state.favorites = { recent: [], popular: [] };
        cleanup();
        cleanup = mount();

        expect(tabLabels()).toEqual([]);
        expect(headings()).toEqual([""]);
        expect(itemTexts()).toEqual(["Azul", "Catan", "Checkers", "Chess"]);
    });
});
