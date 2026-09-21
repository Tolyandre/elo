// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

// jsdom lacks the layout APIs Radix Popover touches while positioning content.
Element.prototype.scrollIntoView = () => {};
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const mocks = vi.hoisted(() => ({
    state: {} as Record<string, unknown>,
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => mocks.state,
}));

// LoginLink (rendered when authRequired) imports the api client, which throws
// without the inlined base URL.
vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
}));

const { SyncStatus } = await import("@/components/sync-status");

const baseState = {
    pendingMatches: [],
    pendingPlayers: [],
    pendingGames: [],
    pendingCount: 0,
    errorCount: 0,
    offline: false,
    isOnline: true,
    apiReachable: true,
    dataFromCache: false,
    isSyncing: false,
    authRequired: false,
    syncNow: () => {},
};

function renderSyncStatus() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<SyncStatus />);
    });
    return {
        text: () => document.body.textContent ?? "",
        open: () => {
            const trigger = container.querySelector("button");
            if (!trigger) throw new Error("SyncStatus trigger not rendered");
            act(() => {
                trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            });
        },
        cloudOffIcon: () => document.body.querySelector(".lucide-cloud-off"),
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

beforeEach(() => {
    mocks.state = { ...baseState };
});

describe("SyncStatus", () => {
    it("renders nothing when online, data fresh and nothing pending", () => {
        const view = renderSyncStatus();
        expect(view.cloudOffIcon()).toBeNull();
        expect(view.text()).not.toContain("Статус сохранения");
        view.unmount();
    });

    it("shows the crossed cloud and slow-connection wording when reads come from the cache", () => {
        mocks.state = { ...baseState, dataFromCache: true };
        const view = renderSyncStatus();
        expect(view.cloudOffIcon()).not.toBeNull();
        view.open();
        expect(view.text()).toContain("Медленное соединение");
        expect(view.text()).toContain("кэша и могут быть устаревшими");
        view.unmount();
    });

    it("does not show the slow-connection wording when fully offline (other wording covers it)", () => {
        mocks.state = { ...baseState, offline: true, isOnline: false, dataFromCache: true };
        const view = renderSyncStatus();
        expect(view.cloudOffIcon()).not.toBeNull();
        view.open();
        expect(view.text()).toContain("Нет сети");
        expect(view.text()).not.toContain("Медленное соединение");
        view.unmount();
    });

    it("keeps the server-down wording when the API is unreachable", () => {
        mocks.state = { ...baseState, offline: true, apiReachable: false, dataFromCache: true };
        const view = renderSyncStatus();
        view.open();
        expect(view.text()).toContain("Сервер API недоступен");
        expect(view.text()).not.toContain("Медленное соединение");
        view.unmount();
    });
});
