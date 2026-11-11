// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared fixture state the module mocks read from.
const state = vi.hoisted(() => ({
    isAuthenticated: true,
    canEdit: true,
    meLoading: false,
    // Connectivity block (ready/offline/isOnline/apiReachable/dataFromCache/isSyncing/authRequired).
    conn: {
        ready: true,
        offline: false,
        isOnline: true,
        apiReachable: true,
        dataFromCache: false,
        isSyncing: false,
        authRequired: false,
    } as Record<string, unknown>,
    pendingMatches: [] as unknown[],
    pendingPlayers: [] as unknown[],
    pendingGames: [] as unknown[],
    ops: [] as unknown[],
    routerPush: vi.fn(),
    deleteOp: vi.fn(),
    resolveOpConflict: vi.fn(),
    syncNow: vi.fn(),
    resolvePendingConflict: vi.fn(),
    deletePendingMatch: vi.fn(),
    updatePendingPlayer: vi.fn(),
    deletePendingPlayer: vi.fn(),
    updatePendingGame: vi.fn(),
    deletePendingGame: vi.fn(),
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => {
        // The real counts include queued ops alongside the pending creates.
        const all = [...state.pendingMatches, ...state.pendingPlayers, ...state.pendingGames, ...state.ops] as Array<{
            status: string;
            error?: string;
        }>;
        return {
            pendingMatches: state.pendingMatches,
            pendingPlayers: state.pendingPlayers,
            pendingGames: state.pendingGames,
            ops: state.ops,
            pendingCount: all.length,
            errorCount: all.filter((i) => i.status === "error").length,
            conflictCount: all.filter((i) => i.status === "conflict").length,
            ...state.conn,
            syncNow: state.syncNow,
            resolvePendingConflict: state.resolvePendingConflict,
            resolveOpConflict: state.resolveOpConflict,
            deleteOp: state.deleteOp,
            deletePendingMatch: state.deletePendingMatch,
            updatePendingPlayer: state.updatePendingPlayer,
            deletePendingPlayer: state.deletePendingPlayer,
            updatePendingGame: state.updatePendingGame,
            deletePendingGame: state.deletePendingGame,
        };
    },
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => ({ isAuthenticated: state.isAuthenticated, canEdit: state.canEdit, loading: state.meLoading }),
}));

// PendingMatchCard resolves names from the server lists.
vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: () => ({
        playerMap: new Map(),
        playerDisplayName: (p: { name: string }) => p.name,
    }),
}));
vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: [], invalidate: () => {} }),
}));
vi.mock("@/app/clubsContext", () => ({
    useClubs: () => ({ clubsForPlayer: () => [] }),
}));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: state.routerPush }),
}));
// OpChanges resolves camp names on the queue page.
vi.mock("@/app/arenas/campsContext", () => ({
    useCamps: () => ({ camps: [], activeCamps: () => [], invalidate: () => {} }),
}));
// LoginLink reads the inlined base URL, which throws without the mock.
vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
}));
// The real PageHeader ships its action to the site header (absent here);
// rendering it inline keeps the header action (sync button) testable.
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

import { PageHeaderProvider } from "@/app/pageHeaderContext";
import OfflineQueuePage from "@/app/offline/page";
import type { PendingGame, PendingMatch, PendingOp, PendingPlayer } from "@/lib/offline/types";
import type { Base58ID } from "@/lib/id";

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
                <OfflineQueuePage />
            </PageHeaderProvider>,
        );
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

function dialogButtonByText(text: string): HTMLButtonElement | null {
    return (
        ([...document.querySelectorAll('[role="dialog"] button')].find(
            (b) => b.textContent?.includes(text),
        ) as HTMLButtonElement | undefined) ?? null
    );
}

const match = (over: Partial<PendingMatch> = {}): PendingMatch =>
    ({
        clientId: "m1" as Base58ID,
        createdAt: "2026-01-01T10:00:00Z",
        status: "pending",
        gameId: "game1" as Base58ID,
        score: { p1: 31, p2: 20 },
        campArenaIds: [],
        ...over,
    }) as PendingMatch;

const player = (over: Partial<PendingPlayer> = {}): PendingPlayer =>
    ({
        clientId: "pl1" as Base58ID,
        createdAt: "2026-01-01T09:00:00Z",
        status: "pending",
        name: "Вася",
        clubIds: [],
        ...over,
    }) as PendingPlayer;

const game = (over: Partial<PendingGame> = {}): PendingGame =>
    ({
        clientId: "g1" as Base58ID,
        createdAt: "2026-01-01T09:00:00Z",
        status: "pending",
        name: "Шахматы",
        tagIds: [],
        ...over,
    }) as PendingGame;

const op = (over: Partial<PendingOp> = {}): PendingOp =>
    ({
        entityId: "sm1" as Base58ID,
        kind: "match",
        op: "update",
        createdAt: "2026-01-01T10:00:00Z",
        status: "pending",
        base: { game_id: "game1", date: "2026-01-05T18:00:00Z", score: { p1: 10 } },
        patch: { date: "2026-01-06T19:00:00Z", score: { p1: 15 } },
        ...over,
    }) as PendingOp;

beforeEach(() => {
    state.isAuthenticated = true;
    state.canEdit = true;
    state.meLoading = false;
    state.conn = { ready: true, offline: false, isOnline: true, apiReachable: true, dataFromCache: false, isSyncing: false, authRequired: false };
    state.pendingMatches = [];
    state.pendingPlayers = [];
    state.pendingGames = [];
    state.ops = [];
    state.routerPush = vi.fn();
    vi.clearAllMocks();
});

afterEach(() => {
    cleanupFn?.();
    container.remove();
});

describe("OfflineQueuePage", () => {
    it("shows the empty state when nothing is queued", async () => {
        mount();
        await flush();

        expect(container.textContent).toContain("Очередь пуста");
        expect(container.textContent).not.toContain("Партии");
    });

    it("lists pending matches, players and games with a sync action", async () => {
        state.pendingMatches = [match()];
        state.pendingPlayers = [player()];
        state.pendingGames = [game()];
        mount();
        await flush();

        expect(container.textContent).toContain("Партии");
        expect(container.textContent).toContain("Несохранённые игроки");
        expect(container.textContent).toContain("Несохранённые игры");
        expect(container.textContent).toContain("в очереди: 3");
        expect(buttonByText("Сохранить на сервере")).not.toBeNull();
        // Editor sees per-match navigation to the existing edit dispatcher.
        expect(container.querySelector('a[href="/matches/edit?id=m1"]')).not.toBeNull();
        expect(buttonByText("Удалить")).not.toBeNull();
    });

    it("opens the view page by clicking the pending match card (no separate Просмотр button)", async () => {
        state.pendingMatches = [match()];
        mount();
        await flush();

        expect(buttonByText("Просмотр")).toBeNull();
        const card = container.querySelector('[data-slot="card"]');
        expect(card).not.toBeNull();
        act(() => (card as HTMLElement).click());
        expect(state.routerPush).toHaveBeenCalledWith("/matches/view?id=m1");
    });

    it("deletes a pending match through the confirm dialog", async () => {
        state.pendingMatches = [match()];
        mount();
        await flush();

        act(() => buttonByText("Удалить")!.click());
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        act(() => dialogButtonByText("Удалить")!.click());
        await flush();

        expect(state.deletePendingMatch).toHaveBeenCalledWith("m1");
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("renders conflicts first with per-field resolution", async () => {
        state.pendingMatches = [
            match({
                status: "conflict",
                conflict: [{ field: "score:p1", label: "Счёт: Вася", ours: "31", theirs: "35" }],
            }),
        ];
        state.pendingPlayers = [
            player({
                clientId: "pl2" as Base58ID,
                name: "Петя",
                status: "conflict",
                conflict: [{ field: "name", label: "Имя", ours: "Петя", theirs: "Пётр" }],
            }),
        ];
        mount();
        await flush();

        expect(container.textContent).toContain("Конфликты");
        expect(container.textContent).toContain("конфликтов: 2");
        expect(container.textContent).toContain("здесь: 31");
        expect(container.textContent).toContain("на сервере: 35");
        expect(container.textContent).toContain("здесь: Петя");
        expect(container.textContent).toContain("на сервере: Пётр");

        // Resolving a field passes the field key and the chosen raw value.
        const keepMine = [...container.querySelectorAll("button")].filter((b) => b.textContent?.includes("Оставить моё"));
        expect(keepMine).toHaveLength(2);
        act(() => keepMine[0].click());
        expect(state.resolvePendingConflict).toHaveBeenCalledWith("match", "m1", { "score:p1": "31" });
        act(() => keepMine[1].click());
        expect(state.resolvePendingConflict).toHaveBeenCalledWith("player", "pl2", { name: "Петя" });
    });

    it("takes the server value when the user picks «Взять с сервера»", async () => {
        state.pendingGames = [
            game({
                status: "conflict",
                conflict: [{ field: "name", label: "Название", ours: "Шахматы", theirs: "Шахматы (изд. 2)" }],
            }),
        ];
        mount();
        await flush();

        act(() => buttonByText("Взять с сервера")!.click());
        expect(state.resolvePendingConflict).toHaveBeenCalledWith("game", "g1", { name: "Шахматы (изд. 2)" });
    });

    it("keeps conflicted items out of the regular lists", async () => {
        state.pendingMatches = [match({ status: "conflict", conflict: [{ field: "date", label: "Дата", ours: "a", theirs: "b" }] })];
        state.pendingPlayers = [player({ status: "conflict", conflict: [{ field: "name", label: "Имя", ours: "a", theirs: "b" }] })];
        mount();
        await flush();

        // Only the Конфликты section carries them — no duplicate rows below.
        expect(container.textContent).toContain("Конфликты");
        expect(container.textContent).not.toContain("Партии");
        expect(container.textContent).not.toContain("Несохранённые игроки");
    });

    it("disables actions and shows notices for non-editors", async () => {
        state.isAuthenticated = false;
        state.pendingMatches = [match()];
        mount();
        await flush();

        expect(container.textContent).toContain("авторизоваться");
        expect(container.querySelector('a[href="/matches/edit?id=m1"]')).toBeNull();
        expect(buttonByText("Сохранить на сервере")).toBeNull();
    });

    it("shows the connectivity wording for a slow connection", async () => {
        state.conn = { ...state.conn, dataFromCache: true };
        state.pendingMatches = [match()];
        mount();
        await flush();

        expect(container.textContent).toContain("Медленное соединение");
    });

    it("shows the re-login alert when auth expired during sync", async () => {
        state.conn = { ...state.conn, authRequired: true };
        mount();
        await flush();

        expect(container.textContent).toContain("Сессия истекла");
    });

    it("renders a match edit op as a match card with the field changes", async () => {
        state.ops = [op()];
        mount();
        await flush();

        expect(container.textContent).toContain("Изменения");
        // The change list speaks in audit labels, not raw field names.
        expect(container.textContent).toContain("Дата");
        // The card carries the queue status, not a bare title row.
        expect(container.textContent).toContain("не сохранено");
        // Clicking the card opens the saved match's view page.
        const card = container.querySelector('[data-slot="card"]');
        expect(card).not.toBeNull();
        act(() => (card as HTMLElement).click());
        expect(state.routerPush).toHaveBeenCalledWith("/matches/view?id=sm1");
    });

    it("renders a game edit op with the derived game name, never the raw id", async () => {
        state.ops = [
            op({
                entityId: "game9" as Base58ID,
                kind: "game",
                base: { alias: null, name_ru: "Шахматы", name_en: "Chess", bgg_ref: 1, tesera_ref: null, game_mode: "competitive" },
                patch: { alias: "chess" },
            }),
        ];
        mount();
        await flush();

        // Accent name = the new alias, secondary = the stored names; the id
        // the page used to show is gone.
        expect(container.textContent).toContain("chess");
        expect(container.textContent).toContain("Шахматы");
        expect(container.textContent).not.toContain("game9");
        expect(container.textContent).toContain("Алиас");
        expect(container.textContent).toContain("не сохранено");
    });

    it("titles a delete op by the entity name and discards ops through Отказаться", async () => {
        state.ops = [
            op({
                entityId: "game9" as Base58ID,
                kind: "game",
                op: "delete",
                patch: undefined,
                base: { alias: null, name_ru: "Шахматы", name_en: null },
            }),
        ];
        mount();
        await flush();

        expect(container.textContent).toContain("Удаление игры «Шахматы»");
        const discard = buttonByText("Отказаться")!;
        expect(discard.className).toContain("bg-destructive");
        act(() => discard.click());
        expect(state.deleteOp).toHaveBeenCalledWith("game9");
    });

    it("shows conflicted update ops as entity cards with the resolution panel", async () => {
        state.ops = [
            op({
                status: "conflict",
                conflict: [{ field: "date", label: "Дата", ours: "2026-01-06T19:00:00Z", theirs: "2026-02-01T10:00:00Z" }],
            }),
        ];
        mount();
        await flush();

        expect(container.textContent).toContain("Конфликты");
        expect(container.textContent).toContain("конфликт");
        expect(container.textContent).toContain("здесь:");
        expect(container.textContent).toContain("на сервере:");
        const keepMine = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Оставить моё"));
        act(() => keepMine!.click());
        expect(state.resolveOpConflict).toHaveBeenCalledWith("sm1", { date: "2026-01-06T19:00:00Z" });
    });
});
