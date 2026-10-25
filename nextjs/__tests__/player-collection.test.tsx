// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    // The viewer's linked player (users.player_id); undefined = signed out.
    playerId: undefined as string | undefined,
    games: [] as { id: string; name: string; image_thumb_url?: string | null }[],
    pendingGames: [] as { clientId: string; name: string }[],
    collection: { total: 0, games: [] as { id: string; name: string; matches_count: number; image_thumb_url?: string | null }[] },
    // The ids the stubbed GameMultiSelect "picks" next.
    pickIds: [] as string[],
    added: [] as string[],
    removed: [] as string[],
    fetches: 0,
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
    useMe: () => ({ playerId: state.playerId }),
}));
// A fresh array per render mirrors the real provider: the post-sync refetch
// swaps the reference, which is what wakes the awaiting-create watcher.
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: [...state.games], invalidate: () => {} }),
}));
vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ pendingGames: state.pendingGames }),
}));
vi.mock("sonner", () => ({
    toast: { success: () => {} },
}));
// The picker's internals are covered elsewhere; the section only needs its
// onChange contract.
vi.mock("@/components/game-multi-select", () => ({
    GameMultiSelect: ({ onChange }: { onChange: (ids: string[]) => void }) => (
        <button data-testid="pick" onClick={() => onChange(state.pickIds)}>
            pick
        </button>
    ),
}));

import { CollectionSection } from "@/app/players/view/collection-section";
import type { Base58ID } from "@/lib/id";

const game = (id: string, name: string) => ({ id, name, matches_count: 0, image_thumb_url: null });

const PLAYER = "player-1" as Base58ID;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cleanupFn: () => void;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<CollectionSection playerId={PLAYER} />);
    });
    cleanupFn = () =>
        act(() => {
            root.unmount();
        });
}

function rerender() {
    act(() => {
        root.render(<CollectionSection playerId={PLAYER} />);
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

function gameLinks(): Element[] {
    return [...container.querySelectorAll('a[href^="/games/view?id="]')];
}

function pick() {
    act(() => (document.querySelector('[data-testid="pick"]') as HTMLButtonElement).click());
}

beforeEach(() => {
    state.playerId = undefined;
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

describe("CollectionSection", () => {
    it("previews twelve games with the total and expands on demand", async () => {
        const games = Array.from({ length: 13 }, (_, i) => game(`g${i}`, `Игра ${i}`));
        state.collection = { total: games.length, games };
        mount();
        await flush();

        expect(container.textContent).toContain("Коллекция игр");
        expect(gameLinks()).toHaveLength(12);
        expect(buttonByText("Показать все (13)")).not.toBeNull();

        act(() => buttonByText("Показать все (13)")!.click());
        expect(gameLinks()).toHaveLength(13);
        expect(buttonByText("Свернуть")).not.toBeNull();

        act(() => buttonByText("Свернуть")!.click());
        expect(gameLinks()).toHaveLength(12);
    });

    it("shows the empty state and hides management from other viewers", async () => {
        state.playerId = "someone-else";
        mount();
        await flush();

        expect(container.textContent).toContain("Коллекция пуста");
        expect(buttonByText("Добавить игру")).toBeNull();
    });

    it("adds several catalog games at once", async () => {
        state.playerId = PLAYER;
        state.games = [game("g1", "Шахматы"), game("g2", "Шашки"), game("g3", "Шашки-2")];
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();
        expect(state.fetches).toBe(1);

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
        state.playerId = PLAYER;
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

    it("removes a game only after the confirmation", async () => {
        state.playerId = PLAYER;
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();

        const remove = container.querySelector('button[aria-label="Убрать «Шахматы» из коллекции"]') as HTMLButtonElement;
        expect(remove).not.toBeNull();
        act(() => remove.click());
        // The confirm dialog is up and nothing is removed yet.
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Убрать игру из коллекции?");
        expect(state.removed).toEqual([]);

        act(() => dialogButtonByText("Убрать")!.click());
        await flush();

        expect(state.removed).toEqual(["g1"]);
        expect(state.fetches).toBe(2);
    });
});
