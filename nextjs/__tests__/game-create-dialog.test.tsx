// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";

// The dialog queues through the offline store and validates against the games
// list; both are mocked, so the tests assert on the boundary calls.
const mocks = vi.hoisted(() => ({
    addPendingGame: vi.fn(),
    suggestGamesPromise: vi.fn(),
    games: [] as GameListItem[],
    pendingGames: [] as PendingGame[],
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ addPendingGame: mocks.addPendingGame, pendingGames: mocks.pendingGames }),
}));
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: mocks.games, invalidate: vi.fn() }),
}));
vi.mock("@/app/tagsContext", () => ({
    useTags: () => ({ tags: [] }),
}));
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ canEdit: true }),
}));
vi.mock("@/app/api", () => ({
    suggestGamesPromise: mocks.suggestGamesPromise,
}));

import { GameCreateDialog } from "@/components/game-create-dialog";
import { toBase58ID } from "@/lib/id";
import type { GameListItem } from "@/app/api";
import type { PendingGame } from "@/lib/offline/types";

function renderDialog(ui: React.ReactElement): { unmount: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(ui);
    });
    return {
        unmount: () => {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

/** The dialog portals to document.body, so lookups go through document.body. */
function findButton(text: string): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`button "${text}" not found`);
    return button;
}

function findInput(placeholder: string): HTMLInputElement {
    const input = document.body.querySelector(`input[placeholder="${placeholder}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`input "${placeholder}" not found`);
    return input;
}

/** React tracks the value prop, so the native setter must bypass it. */
function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

const pandoria: GameListItem = {
    id: toBase58ID("3UpX8ijxUfHsWLLuBWZvhq")!,
    name: "Пандория",
    alias: null,
    name_en: "Pandoria",
    name_ru: "Пандория",
    bgg_ref: null,
    tesera_ref: null,
    image_url: null,
    image_thumb_url: null,
    game_mode: "competitive",
    last_played_order: 0,
    total_matches: 0,
    tags: [],
};

const pendingGame: PendingGame = {
    clientId: toBase58ID("4VqY9ijyUfHsWLLuBWZvhq")!,
    createdAt: "2026-10-27T10:00:00.000Z",
    status: "pending",
    name: "Терра Мистика",
};

function renderCreateDialog(initialName: string, onCreated: (id: unknown) => void = vi.fn()) {
    const onOpenChange = vi.fn();
    const dialog = renderDialog(
        <GameCreateDialog
            open
            onOpenChange={onOpenChange}
            initialName={initialName}
            onCreated={onCreated}
        />,
    );
    return { onOpenChange, onCreated, ...dialog };
}

describe("GameCreateDialog", () => {
    beforeEach(() => {
        mocks.addPendingGame.mockReset();
        mocks.suggestGamesPromise.mockReset();
        mocks.games = [];
        mocks.pendingGames = [];
        mocks.suggestGamesPromise.mockImplementation(
            async () => ({ games: [], teseraUnavailable: false, bggUnavailable: false, failed: false }),
        );
    });

    it("unique name: сохранение queues the game and reports its id", () => {
        const clientId = toBase58ID("5WrZ8ijyUfHsWLLuBWZvhq")!;
        mocks.addPendingGame.mockReturnValue({ clientId });
        const { onCreated, onOpenChange, unmount } = renderCreateDialog("ПандорияXL");

        act(() => {
            findButton("Сохранить").click();
        });
        expect(mocks.addPendingGame).toHaveBeenCalledTimes(1);
        expect(mocks.addPendingGame).toHaveBeenCalledWith("ПандорияXL", [], {
            nameEn: undefined,
            nameRu: undefined,
            bggRef: undefined,
            teseraRef: undefined,
            gameMode: "competitive",
        });
        expect(onCreated).toHaveBeenCalledWith(clientId);
        expect(onOpenChange).toHaveBeenCalledWith(false);
        unmount();
    });

    it("name from the games list: ошибка показывается, сохранение заблокировано", () => {
        mocks.games = [pandoria];
        const { onCreated, unmount } = renderCreateDialog("пандория");

        expect(document.body.textContent).toContain("Игра «Пандория» уже существует");
        expect(findButton("Сохранить").disabled).toBe(true);
        act(() => {
            findButton("Сохранить").click();
        });
        expect(mocks.addPendingGame).not.toHaveBeenCalled();
        expect(onCreated).not.toHaveBeenCalled();

        // Renaming away from the collision unblocks the save.
        act(() => {
            setInputValue(findInput("Название игры"), "Другая игра");
        });
        expect(findButton("Сохранить").disabled).toBe(false);
        unmount();
    });

    it("name from the offline queue: незасинхроненная игра тоже блокирует", () => {
        mocks.pendingGames = [pendingGame];
        const { unmount } = renderCreateDialog("Терра Мистика");

        expect(document.body.textContent).toContain("уже существует");
        expect(findButton("Сохранить").disabled).toBe(true);
        expect(mocks.addPendingGame).not.toHaveBeenCalled();
        unmount();
    });
});
