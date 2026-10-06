// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";

// The dialog talks to the API barrel and the offline store; both are mocked,
// so the tests assert on the boundary calls (PATCH vs offline queue).
const mocks = vi.hoisted(() => ({
    addPendingGame: vi.fn(),
    patchGamePromise: vi.fn(),
    suggestGamesPromise: vi.fn(async () => []),
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ addPendingGame: mocks.addPendingGame }),
}));
vi.mock("@/app/api", () => ({
    patchGamePromise: mocks.patchGamePromise,
    suggestGamesPromise: mocks.suggestGamesPromise,
}));

import { GameEditDialog } from "@/components/admin/game-edit-dialog";
import { toBase58ID } from "@/lib/id";
import type { GameListItem } from "@/app/api";

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

const game: GameListItem = {
    id: toBase58ID("3UpX8ijxUfHsWLLuBWZvhq")!,
    name: "Скелет Кинг",
    alias: null,
    name_en: "Skull King",
    name_ru: "Скелет Кинг",
    bgg_ref: 12345,
    tesera_ref: null,
    image_url: null,
    image_thumb_url: null,
    game_mode: "competitive",
    last_played_order: 0,
    total_matches: 3,
    tags: [],
};

describe("GameEditDialog", () => {
    beforeEach(() => {
        mocks.addPendingGame.mockClear();
        mocks.patchGamePromise.mockReset();
    });

    it("create mode: добавление disabled until named, then queues the game with its metadata", () => {
        const onClose = vi.fn();
        const onSaved = vi.fn();
        const { unmount } = renderDialog(
            <GameEditDialog game={null} onClose={onClose} onSaved={onSaved} />,
        );

        expect(document.body.textContent).toContain("Новая игра");

        const add = () => findButton("Добавить");
        expect(add().disabled).toBe(true);

        act(() => {
            setInputValue(findInput("например, Скелет Кинг"), "Скелет Кинг");
        });
        expect(add().disabled).toBe(false);

        act(() => {
            add().click();
        });
        expect(mocks.addPendingGame).toHaveBeenCalledTimes(1);
        expect(mocks.addPendingGame).toHaveBeenCalledWith("Скелет Кинг", [], {
            nameEn: null,
            nameRu: null,
            bggRef: null,
            teseraRef: null,
            gameMode: "competitive",
        });
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(mocks.patchGamePromise).not.toHaveBeenCalled();
        unmount();
    });

    it("edit mode: сохранение patches the full metadata state", async () => {
        mocks.patchGamePromise.mockResolvedValue(undefined);
        const onClose = vi.fn();
        const onSaved = vi.fn();
        const { unmount } = renderDialog(
            <GameEditDialog game={game} onClose={onClose} onSaved={onSaved} />,
        );

        expect(document.body.textContent).toContain("Изменить игру");

        act(() => {
            findButton("Сохранить").click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(mocks.patchGamePromise).toHaveBeenCalledTimes(1);
        expect(mocks.patchGamePromise).toHaveBeenCalledWith(game.id, {
            alias: null,
            name_en: "Skull King",
            name_ru: "Скелет Кинг",
            bgg_ref: 12345,
            tesera_ref: null,
            game_mode: "competitive",
        });
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(mocks.addPendingGame).not.toHaveBeenCalled();
        unmount();
    });

    it("create mode: отмена closes without queueing a game", () => {
        const onClose = vi.fn();
        const onSaved = vi.fn();
        const { unmount } = renderDialog(
            <GameEditDialog game={null} onClose={onClose} onSaved={onSaved} />,
        );

        act(() => {
            findButton("Отмена").click();
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSaved).not.toHaveBeenCalled();
        expect(mocks.addPendingGame).not.toHaveBeenCalled();
        unmount();
    });
});
