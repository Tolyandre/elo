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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { GameListItem } from "@/app/api";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    games: [] as GameListItem[],
    pendingGames: [] as { clientId: string; name: string; meta?: { gameMode?: string } }[],
}));

const mocks = vi.hoisted(() => ({
    addPendingGame: vi.fn(),
    suggestGamesPromise: vi.fn(),
}));

vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: state.games }),
}));
vi.mock("@/app/matches/MatchesContext", () => ({
    useMatches: () => ({ matches: [] }),
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ playerId: undefined, canEdit: true }),
}));
vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ pendingGames: state.pendingGames, addPendingGame: mocks.addPendingGame }),
}));
vi.mock("@/app/useFavoriteGames", () => ({
    useFavoriteGames: () => ({ recent: [], popular: [] }),
}));
vi.mock("@/app/tagsContext", () => ({
    useTags: () => ({ tags: [] }),
}));
// The create dialog's catalogue lookup talks to the API client (env-var
// gated) — not under test; it resolves to no suggestions.
mocks.suggestGamesPromise.mockResolvedValue({
    games: [],
    teseraUnavailable: false,
    bggUnavailable: false,
    failed: false,
});
vi.mock("@/app/api", () => ({
    suggestGamesPromise: mocks.suggestGamesPromise,
}));
// Render the dropdown inline instead of through a Radix portal.
vi.mock("@/components/ui/popover", () => ({
    Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverContent: ({ children }: { children: ReactNode }) => (
        <div data-testid="popover-content">{children}</div>
    ),
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { GameMultiSelect } from "@/components/game-multi-select";
import type { Base58ID } from "@/lib/id";

const game = (id: string, name: string): GameListItem =>
    ({ id, name, alias: null, name_en: null, name_ru: null, total_matches: 0, last_played_order: 0, tags: [] }) as unknown as GameListItem;

const chess = game("g1", "Chess");
const catan = game("g2", "Catan");

let container: HTMLDivElement;

function mount(
    props: { value?: Base58ID[]; onChange?: (ids: Base58ID[]) => void; filter?: (g: GameListItem) => boolean } = {},
): void {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<GameMultiSelect value={props.value ?? []} onChange={props.onChange} filter={props.filter} />);
    });
}

function type(query: string) {
    const input = document.body.querySelector<HTMLInputElement>("input[cmdk-input]")!;
    // React tracks controlled-input values through its own setter; assigning
    // via the prototype setter is what makes the synthetic onChange fire.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
        setValue.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** The create dialog portals to document.body, so lookups go through it. */
function findButton(text: string): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`button "${text}" not found`);
    return button;
}

function clickTab(label: string) {
    const tab = Array.from(document.body.querySelectorAll("[role=tab]")).find(
        (t) => t.textContent === label,
    );
    if (!tab) throw new Error(`tab "${label}" not found`);
    // Radix TabsTrigger activates on mousedown (button 0, no ctrl).
    act(() => {
        tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
}

beforeEach(() => {
    state.games = [chess, catan];
    state.pendingGames = [];
    mocks.addPendingGame.mockReset();
    document.body.innerHTML = "";
});

describe("GameMultiSelect", () => {
    it("lists offline pending games in their own group and tab", () => {
        state.pendingGames = [{ clientId: "offline-1", name: "Скелет Кинг" }];
        mount();
        const tabLabels = Array.from(document.body.querySelectorAll("[role=tab]")).map(
            (t) => t.textContent ?? "",
        );
        expect(tabLabels).toContain("Офлайн");
        clickTab("Офлайн");
        expect(document.body.textContent).toContain("Офлайн (не сохранено)");
        expect(document.body.textContent).toContain("Скелет Кинг (офлайн)");
        // The pending game is also reachable through search without the tab.
        type("Скелет");
        expect(document.body.textContent).toContain("Скелет Кинг (офлайн)");
    });

    it("hides pending coop games when a catalog filter is set (ADR-33)", () => {
        state.pendingGames = [
            { clientId: "offline-1", name: "Пандемия", meta: { gameMode: "coop" } },
            { clientId: "offline-2", name: "Корпорация", meta: { gameMode: "competitive" } },
        ];
        mount({ filter: () => true });
        clickTab("Офлайн");
        expect(document.body.textContent).not.toContain("Пандемия (офлайн)");
        expect(document.body.textContent).toContain("Корпорация (офлайн)");
    });

    it("offers create only when nothing matches the search", () => {
        mount();
        type("Chess");
        expect(document.body.textContent).not.toContain("Добавить «Chess»");
        type("Токайдо");
        expect(document.body.textContent).toContain("Добавить «Токайдо»");
    });

    it("creates a game from the empty search state and selects it", async () => {
        mocks.addPendingGame.mockReturnValue({ clientId: "offline-9" });
        const onChange = vi.fn();
        mount({ onChange });
        type("Токайдо");
        act(() => {
            findButton("Добавить «Токайдо»").click();
        });
        expect(document.body.textContent).toContain("Новая игра");
        const nameInput = document.body.querySelector<HTMLInputElement>(
            'input[aria-label="Название новой игры"]',
        )!;
        expect(nameInput.value).toBe("Токайдо");
        await act(async () => {
            findButton("Сохранить").click();
        });
        expect(mocks.addPendingGame).toHaveBeenCalledWith(
            "Токайдо",
            [],
            expect.objectContaining({ gameMode: "competitive" }),
        );
        expect(onChange).toHaveBeenCalledWith(["offline-9"]);
    });
});
