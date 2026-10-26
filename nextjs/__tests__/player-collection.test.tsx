// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    // The viewer: canEdit is the collection-edit gate (the profile itself is
    // read-only for everyone).
    canEdit: false,
    collection: { total: 0, games: [] as { id: string; name: string; matches_count: number; image_thumb_url?: string | null }[] },
    fetches: 0,
}));

vi.mock("@/app/api", () => ({
    getPlayerGameCollectionPromise: async () => {
        state.fetches++;
        return state.collection;
    },
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ canEdit: state.canEdit }),
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
    return container;
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

function gameLinks(): Element[] {
    return [...container.querySelectorAll('a[href^="/games/view?id="]')];
}

beforeEach(() => {
    state.canEdit = false;
    state.collection = { total: 0, games: [] };
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

    it("is read-only for every viewer: no add or remove controls", async () => {
        state.canEdit = true;
        state.collection = { total: 1, games: [game("g1", "Шахматы")] };
        mount();
        await flush();

        // No «Добавить», no per-chip remove buttons — the profile shows the
        // shelf, the edit page changes it.
        expect(buttonByText("Добавить")).toBeNull();
        expect(container.querySelector('button[aria-label="Убрать «Шахматы» из коллекции"]')).toBeNull();
        // The games still link to their pages.
        expect(gameLinks()).toHaveLength(1);
    });

    it("renders only the header with a zero badge when empty", async () => {
        mount();
        await flush();

        // No placeholder: the empty shelf is just «Коллекция игр 0» (and the
        // pencil for editors).
        expect(container.textContent).not.toContain("Коллекция пуста");
        expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe("0");
        expect(buttonByText("Добавить игру")).toBeNull();
    });

    it("offers editors the pencil link to the collection edit page", async () => {
        state.canEdit = true;
        mount();
        await flush();

        const edit = container.querySelector('a[href="/players/collection?id=player-1"]') as HTMLAnchorElement | null;
        expect(edit).not.toBeNull();
        expect(edit!.getAttribute("aria-label")).toBe("Изменить коллекцию игр");
    });

    it("hides the edit pencil from non-editors", async () => {
        mount();
        await flush();

        expect(container.querySelector('a[href^="/players/collection"]')).toBeNull();
    });
});
