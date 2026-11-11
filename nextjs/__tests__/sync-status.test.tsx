// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

const mocks = vi.hoisted(() => ({
    state: {} as Record<string, unknown>,
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: () => mocks.state,
}));

const { SyncStatus } = await import("@/components/sync-status");

const baseState = {
    pendingMatches: [],
    pendingPlayers: [],
    pendingGames: [],
    pendingCount: 0,
    errorCount: 0,
    conflictCount: 0,
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
        link: () => container.querySelector("a"),
        badge: () => container.querySelector('[data-slot="badge"]'),
        cloudOffIcon: () => container.querySelector(".lucide-cloud-off"),
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
        expect(view.link()).toBeNull();
        view.unmount();
    });

    it("links to the /offline queue page when offline", () => {
        mocks.state = { ...baseState, offline: true, isOnline: false };
        const view = renderSyncStatus();
        expect(view.cloudOffIcon()).not.toBeNull();
        expect(view.link()?.getAttribute("href")).toBe("/offline");
        view.unmount();
    });

    it("keeps the crossed cloud for cached reads between pings", () => {
        mocks.state = { ...baseState, dataFromCache: true };
        const view = renderSyncStatus();
        expect(view.cloudOffIcon()).not.toBeNull();
        expect(view.link()?.getAttribute("href")).toBe("/offline");
        view.unmount();
    });

    it("shows a secondary count badge for a healthy pending queue", () => {
        mocks.state = { ...baseState, pendingCount: 3 };
        const view = renderSyncStatus();
        expect(view.badge()?.textContent).toBe("3");
        expect(view.badge()?.className).toContain("bg-secondary");
        view.unmount();
    });

    it("marks the badge destructive when items have errors or conflicts", () => {
        mocks.state = { ...baseState, pendingCount: 2, errorCount: 1 };
        const view = renderSyncStatus();
        expect(view.badge()?.className).toContain("bg-destructive");
        view.unmount();

        mocks.state = { ...baseState, pendingCount: 2, conflictCount: 1 };
        const view2 = renderSyncStatus();
        expect(view2.badge()?.className).toContain("bg-destructive");
        view2.unmount();
    });
});
