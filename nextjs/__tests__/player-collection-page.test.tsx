// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    // The viewer's edit permission — the whole page gates on it.
    canEdit: true,
    games: [] as { id: string; name: string; image_thumb_url?: string | null }[],
    pendingGames: [] as { clientId: string; name: string }[],
    collection: { total: 0, games: [] as { id: string; name: string; matches_count: number; image_thumb_url?: string | null }[] },
    // The ids the stubbed GameMultiSelect "picks" next.
    pickIds: [] as string[],
    added: [] as string[],
    removed: [] as string[],
    fetches: 0,
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(`id=${PLAYER}`),
}));

vi.mock("@/app/api", () => ({
    getPlayerGameCollectionPromise: async () => {
        state.fetches++;
        return state.collection;
    },
    addPlayerGamePromise: async (_playerId: string, gameId: string) => {
        state.added.push(gameId);
        return state.collection;
    },
    removePlayerGamePromise: async (_playerId: string, gameId: string) => {
        state.removed.push(gameId);
        return state.collection;
    },
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ canEdit: state.canEdit, loading: false }),
}));
// A fresh array per render mirrors the real provider: the post-sync refetch
// swaps the reference, which is what wakes the awaiting-create watcher.
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: [...state.games], invalidate: () => {} }),
}));
vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: () => ({
        playerMap: new Map([[PLAYER, { id: PLAYER, name: "Коллекционер", geologist_name: null }]]),
        playerDisplayName: (p: { name: string }) => p.name,
    }),
}));
vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ pendingGames: state.pendingGames }),
}));
vi.mock("sonner", () => ({
    toast: { success: vi.fn() },
}));
// The picker's internals are covered elsewhere; the page only needs its
// onChange contract.
vi.mock("@/components/game-multi-select", () => ({
    GameMultiSelect: ({ onChange }: { onChange: (ids: string[]) => void }) => (
        <button data-testid="pick" onClick={() => onChange(state.pickIds)}>
            pick
        </button>
    ),
}));

import { PageHeaderProvider } from "@/app/pageHeaderContext";
import PlayerCollectionPage from "@/app/players/collection/page";
import type { Base58ID } from "@/lib/id";

// The real PageHeader ships its action to the site header (rendered by the
// root layout, absent here); rendering it inline keeps the header-button flow
// (click «Добавить» → dialog) testable in jsdom.
vi.mock("@/app/pageHeaderContext", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/pageHeaderContext")>();
    return {
        ...actual,
        PageHeader: ({ title, action }: { title: string; action?: ReactNode }) => (
            <>
                <h1 data-testid="page-title">{title}</h1>
                {action}
            </>
        ),
    };
});

const game = (id: string, name: string) => ({ id, name, matches_count: 0, image_thumb_url: null });

// A valid Base58 id: the page parses ?id= through toBase58ID, which rejects
// anything else with «Игрок не указан».
const PLAYER = "1111111111111113" as Base58ID;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cleanupFn: () => void;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <PageHeaderProvider>
                <PlayerCollectionPage />
            </PageHeaderProvider>,
        );
    });
    cleanupFn = () =>
        act(() => {
            root.unmount();
        });
    return container;
}

function rerender() {
    act(() => {
        root.render(
            <PageHeaderProvider>
                <PlayerCollectionPage />
            </PageHeaderProvider>,
        );
    });
}

function flush() {
    return act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

function buttonByText(text: string): HTMLButtonElement | null {
    return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) ?? null;
}

function dialogButtonByText(text: string): HTMLButtonElement | null {
    return (
        ([...document.querySelectorAll('[role="dialog"] button')].find(
            (b) => b.textContent?.includes(text),
        ) as HTMLButtonElement | undefined) ?? null
    );
}

function pick() {
    act(() => (document.querySelector('[data-testid="pick"]') as HTMLButtonElement).click());
}

beforeEach(() => {
    state.canEdit = true;
    state.games = [];
    state.pendingGames = [];
    state.collection = { total: 0, games: [] };
    state.pickIds = [];
    state.added = [];
    state.removed = [];
    state.fetches = 0;
});

afterEach(() => {
    cleanupFn?.();
    container.remove();
});

describe("PlayerCollectionPage", () => {
    it("renders the whole collection: every game with its remove button", async () => {
        const games = Array.from({ length: 13 }, (_, i) => game(`g${i}`, `Игра ${i}`));
        state.collection = { total: games.length, games };
        mount();
        await flush();

        // Full size: no twelve-game preview cut, no «Показать все». The card
        // header carries the count as a chip next to the title.
        expect(container.textContent).toContain("Коллекция игр");
        expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe("13");
        expect(container.querySelectorAll('a[href^="/games/view?id="]')).toHaveLength(13);
        expect(buttonByText("Показать все")).toBeNull();
        expect(container.querySelectorAll('button[aria-label^="Убрать «"]')).toHaveLength(13);
    });

    it("removes a game immediately — no confirmation prompt", async () => {
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();

        const remove = container.querySelector('button[aria-label="Убрать «Шахматы» из коллекции"]') as HTMLButtonElement;
        act(() => remove.click());
        await flush();

        // No confirm dialog appeared anywhere and the write went through.
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(state.removed).toEqual(["g1"]);
        expect(state.fetches).toBe(2);
    });

    it("adds several catalog games at once via the picker dialog", async () => {
        state.games = [game("g1", "Шахматы"), game("g2", "Шашки"), game("g3", "Шашки-2")];
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();

        act(() => buttonByText("Добавить")!.click());
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        state.pickIds = ["g2", "g3"];
        pick();
        expect(dialogButtonByText("Добавить (2)")).not.toBeNull();
        act(() => dialogButtonByText("Добавить (2)")!.click());
        await flush();

        expect([...state.added].sort()).toEqual(["g2", "g3"]);
        // The write refreshes the collection and the dialog closes.
        expect(state.fetches).toBe(2);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("queues a brand-new offline game until the catalog learns it", async () => {
        state.games = [game("g1", "Шахматы")];
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        state.pendingGames = [{ clientId: "fresh-1", name: "Совершенно новая" }];
        mount();
        await flush();

        act(() => buttonByText("Добавить")!.click());
        // The picker's create flow reports the fresh game's final id — not in
        // the catalog yet, so nothing hits the server.
        state.pickIds = ["fresh-1"];
        pick();
        act(() => dialogButtonByText("Добавить (1)")!.click());
        await flush();

        expect(state.added).toEqual([]);
        expect(container.textContent).toContain("синхронизация");

        // The sync lands: the catalog learns the game, the watcher adds it.
        state.games = [...state.games, game("fresh-1", "Совершенно новая")];
        rerender();
        await flush();

        expect(state.added).toEqual(["fresh-1"]);
        expect(container.textContent).not.toContain("синхронизация");
    });

    it("shows the empty state with an add action", async () => {
        mount();
        await flush();

        expect(container.textContent).toContain("Коллекция пуста");
        expect(buttonByText("Добавить игру")).not.toBeNull();
    });

    it("denies non-editors: a notice instead of the shelf", async () => {
        state.canEdit = false;
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();

        expect(container.textContent).toContain("нет прав");
        expect(buttonByText("Добавить")).toBeNull();
        expect(container.querySelectorAll('button[aria-label^="Убрать «"]')).toHaveLength(0);
        expect(state.fetches).toBe(1); // the collection GET still ran, then gated
    });
});
