// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";

// The dialog talks to the API barrel and the offline store; both are mocked,
// so the tests assert on the boundary calls (PATCH vs offline queue).
const mocks = vi.hoisted(() => ({
    addPendingGame: vi.fn(),
    patchGamePromise: vi.fn(),
    suggestGamesPromise: vi.fn(),
    refreshGameArtPromise: vi.fn(),
    invalidateGames: vi.fn(),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
    games: [] as GameListItem[],
    pendingGames: [] as PendingGame[],
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => ({ addPendingGame: mocks.addPendingGame, pendingGames: mocks.pendingGames }),
}));
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: mocks.games, invalidate: mocks.invalidateGames }),
}));
vi.mock("sonner", () => ({
    toast: { success: mocks.toastSuccess, info: mocks.toastInfo, error: mocks.toastError },
}));
vi.mock("@/app/api", () => ({
    patchGamePromise: mocks.patchGamePromise,
    suggestGamesPromise: mocks.suggestGamesPromise,
    refreshGameArtPromise: mocks.refreshGameArtPromise,
}));

import { GameEditDialog } from "@/components/admin/game-edit-dialog";
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

/** Buttons whose icon carries an SVG <title> never match by exact text. */
function findButtonContaining(text: string): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll("button")).find(
        (b) => b.textContent?.includes(text),
    );
    if (!button) throw new Error(`button containing "${text}" not found`);
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
        mocks.suggestGamesPromise.mockReset();
        mocks.refreshGameArtPromise.mockReset();
        mocks.invalidateGames.mockClear();
        mocks.toastSuccess.mockClear();
        mocks.toastInfo.mockClear();
        mocks.toastError.mockClear();
        mocks.games = [];
        mocks.pendingGames = [];
        mocks.suggestGamesPromise.mockImplementation(
            async () => ({ games: [], teseraUnavailable: false, bggUnavailable: false, failed: false }),
        );
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
            setInputValue(findInput("например, Бутылочка"), "Скелет Кинг");
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

    it("create mode: имя существующей игры блокирует добавление", () => {
        mocks.games = [{ ...game }];
        const onSaved = vi.fn();
        const { unmount } = renderDialog(
            <GameEditDialog game={null} onClose={vi.fn()} onSaved={onSaved} />,
        );

        act(() => {
            setInputValue(findInput("например, Бутылочка"), "скелет кинг");
        });
        expect(document.body.textContent).toContain("уже существует");
        expect(findButton("Добавить").disabled).toBe(true);
        act(() => {
            findButton("Добавить").click();
        });
        expect(mocks.addPendingGame).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();

        // Renaming away from the collision unblocks the save.
        act(() => {
            setInputValue(findInput("например, Бутылочка"), "Пандория");
        });
        expect(findButton("Добавить").disabled).toBe(false);
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

    it("picker: accepts a BGG-only candidate and flags the degraded Tesera catalogue", async () => {
        vi.useFakeTimers();
        try {
            mocks.suggestGamesPromise.mockResolvedValue({
                games: [
                    {
                        bgg_ref: 822,
                        tesera_ref: null,
                        name_en: "Carcassonne",
                        name_ru: null,
                        title: "Carcassonne",
                        is_addition: false,
                    },
                ],
                teseraUnavailable: true,
                bggUnavailable: false,
                failed: false,
            });
            const onClose = vi.fn();
            const onSaved = vi.fn();
            const { unmount } = renderDialog(
                <GameEditDialog game={null} onClose={onClose} onSaved={onSaved} />,
            );

            expect(document.body.textContent).toContain("Подобрать в каталогах BGG и Tesera");

            act(() => {
                setInputValue(findInput("Название для поиска"), "Каркассон");
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(350);
            });

            expect(document.body.textContent).toContain(
                "Каталог Tesera недоступен — показаны результаты BoardGameGeek.",
            );

            // Accepting a BGG-only candidate fills the English name and the
            // BGG id; the empty Tesera id stays empty. The alias field is
            // never touched by a pick — the queued name falls back to the
            // canonical English title.
            act(() => {
                findButton("Carcassonne").click();
            });
            expect(findInput("например, Бутылочка").value).toBe("");
            act(() => {
                findButton("Добавить").click();
            });
            expect(mocks.addPendingGame).toHaveBeenCalledWith("Carcassonne", [], {
                nameEn: "Carcassonne",
                nameRu: null,
                bggRef: 822,
                teseraRef: null,
                gameMode: "competitive",
            });
            expect(onSaved).toHaveBeenCalledTimes(1);
            unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("picker: выбор кандидата оставляет псевдоним без изменений", async () => {
        vi.useFakeTimers();
        try {
            mocks.suggestGamesPromise.mockResolvedValue({
                games: [
                    {
                        bgg_ref: 822,
                        tesera_ref: 62490,
                        name_en: "Carcassonne",
                        name_ru: "Каркассон",
                        title: "Carcassonne",
                        is_addition: false,
                    },
                ],
                teseraUnavailable: false,
                bggUnavailable: false,
                failed: false,
            });
            const withAlias = { ...game, alias: "Бутылочка" };
            const { unmount } = renderDialog(
                <GameEditDialog game={withAlias} onClose={vi.fn()} onSaved={vi.fn()} />,
            );

            act(() => {
                setInputValue(findInput("Название для поиска"), "Каркассон");
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(350);
            });
            act(() => {
                findButtonContaining("Carcassonne").click();
            });

            // The pick fills the canonical fields but never rewrites the alias.
            expect(findInput("например, Бутылочка").value).toBe("Бутылочка");
            act(() => {
                findButton("Сохранить").click();
            });
            await act(async () => {
                await Promise.resolve();
            });
            expect(mocks.patchGamePromise).toHaveBeenCalledWith(
                withAlias.id,
                expect.objectContaining({ alias: "Бутылочка", name_en: "Carcassonne", name_ru: "Каркассон" }),
            );
            unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("picker: показывает поиск, а затем сбой каталогов вместо пустого результата", async () => {
        vi.useFakeTimers();
        try {
            let resolveSuggest: (v: unknown) => void = () => {};
            mocks.suggestGamesPromise.mockImplementation(
                () => new Promise((resolve) => { resolveSuggest = resolve; }),
            );
            const { unmount } = renderDialog(
                <GameEditDialog game={game} onClose={vi.fn()} onSaved={vi.fn()} />,
            );

            act(() => {
                setInputValue(findInput("Название для поиска"), "Скелет Кинг");
            });
            // Loading covers the debounce window too — from the first
            // qualifying keystroke, not 350ms later.
            expect(document.body.textContent).toContain("Ищем в каталогах…");

            await act(async () => {
                await vi.advanceTimersByTimeAsync(350);
            });
            expect(document.body.textContent).toContain("Ищем в каталогах…");

            await act(async () => {
                resolveSuggest({ games: [], teseraUnavailable: false, bggUnavailable: false, failed: true });
            });
            expect(document.body.textContent).toContain(
                "Каталоги недоступны — не удалось выполнить поиск.",
            );
            expect(document.body.textContent).not.toContain("Ничего не найдено");
            unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("edit mode: Обновить обложку saves first, then refreshes, and keeps the dialog open", async () => {
        mocks.patchGamePromise.mockResolvedValue(undefined);
        mocks.refreshGameArtPromise.mockResolvedValue({
            id: game.id,
            name: game.name,
            refreshed: true,
            image_url: "https://cf.geekdo-images.com/original/img/sk.png",
            image_thumb_url: "https://cf.geekdo-images.com/small/img/sk.png",
            reason: null,
        });
        const onClose = vi.fn();
        const onSaved = vi.fn();
        const { unmount } = renderDialog(
            <GameEditDialog game={game} onClose={onClose} onSaved={onSaved} />,
        );

        act(() => {
            findButtonContaining("Обновить обложку").click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        // The refresh persists the possibly-just-typed BGG id before fetching
        // by it, and overwrites the preview with the returned art.
        expect(mocks.patchGamePromise).toHaveBeenCalledWith(game.id, {
            alias: null,
            name_en: "Skull King",
            name_ru: "Скелет Кинг",
            bgg_ref: 12345,
            tesera_ref: null,
            game_mode: "competitive",
        });
        expect(mocks.refreshGameArtPromise).toHaveBeenCalledWith(game.id);
        expect(mocks.patchGamePromise.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.refreshGameArtPromise.mock.invocationCallOrder[0],
        );
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
        expect(mocks.invalidateGames).toHaveBeenCalledTimes(1);
        const img = document.body.querySelector("img");
        expect(img?.getAttribute("src")).toBe("https://cf.geekdo-images.com/small/img/sk.png");
        // The dialog stays open for further edits.
        expect(onSaved).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        unmount();
    });

    it("edit mode: Обновить обложку disabled without a BGG id; a reason reports instead of success", async () => {
        const noBgg = { ...game, bgg_ref: null };
        mocks.patchGamePromise.mockResolvedValue(undefined);
        mocks.refreshGameArtPromise.mockResolvedValue({
            id: game.id,
            name: game.name,
            refreshed: false,
            image_url: null,
            image_thumb_url: null,
            reason: "no image on BGG",
        });
        const { unmount } = renderDialog(
            <GameEditDialog game={noBgg} onClose={vi.fn()} onSaved={vi.fn()} />,
        );

        expect(findButtonContaining("Обновить обложку").disabled).toBe(true);
        // Typing an id enables the flow.
        act(() => {
            const inputs = Array.from(document.body.querySelectorAll("input[inputmode='numeric']"));
            setInputValue(inputs[0] as HTMLInputElement, "12345");
        });
        expect(findButtonContaining("Обновить обложку").disabled).toBe(false);

        act(() => {
            findButtonContaining("Обновить обложку").click();
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(mocks.refreshGameArtPromise).toHaveBeenCalledWith(noBgg.id);
        expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        unmount();
    });
});
