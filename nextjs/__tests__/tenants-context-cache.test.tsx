// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    listTenants: vi.fn(),
}));

vi.mock("../app/api", () => ({
    listTenantsPromise: mocks.listTenants,
}));

import { TenantsProvider, useTenants } from "../app/tenantsContext";
import { encodeId } from "../lib/id";

// The whole tenant-scoped UI resolves the current community from this list
// (ADR-36), so offline it must come from the localStorage cache — a failed
// fetch with nothing cached has to surface as "list unavailable", never as a
// deleted community.
const TENANTS_CACHE_KEY = "tenants-cache-v1";

const BLUE_MEN = { id: encodeId("00000000-0000-0000-0000-0000000000b1"), name: "Синие люди", club_ids: [] };

const capturedRef: { current: ReturnType<typeof useTenants> | undefined } = { current: undefined };

function Probe() {
    const ctx = useTenants();
    // The capture goes through an effect (the react-hooks lint rightly
    // forbids writing outer variables during render); act() flushes it.
    useEffect(() => {
        capturedRef.current = ctx;
    });
    return null;
}

function renderTenants() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: ReturnType<typeof createRoot> | undefined;
    act(() => {
        root = createRoot(container);
        root.render(<TenantsProvider><Probe /></TenantsProvider>);
    });
    return {
        unmount: () => {
            act(() => root!.unmount());
            container.remove();
        },
    };
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

describe("TenantsProvider localStorage cache (offline resolution)", () => {
    it("a successful fetch exposes the list and writes the cache", async () => {
        mocks.listTenants.mockResolvedValue([BLUE_MEN]);
        const view = renderTenants();
        await act(async () => {});
        expect(capturedRef.current?.tenants).toEqual([BLUE_MEN]);
        expect(capturedRef.current?.error).toBeNull();
        expect(JSON.parse(localStorage.getItem(TENANTS_CACHE_KEY)!)).toEqual([BLUE_MEN]);
        view.unmount();
    });

    it("a failed fetch with no cache surfaces the error — not a deleted community", async () => {
        mocks.listTenants.mockRejectedValue(new Error("Нет соединения с сервером"));
        const view = renderTenants();
        await act(async () => {});
        expect(capturedRef.current?.tenants).toEqual([]);
        expect(capturedRef.current?.error).toBe("Нет соединения с сервером");
        expect(capturedRef.current?.loading).toBe(false);
        view.unmount();
    });

    it("a failed fetch with a cached copy serves the cache and stays quiet", async () => {
        localStorage.setItem(TENANTS_CACHE_KEY, JSON.stringify([BLUE_MEN]));
        mocks.listTenants.mockRejectedValue(new Error("Нет соединения с сервером"));
        const view = renderTenants();
        await act(async () => {});
        expect(capturedRef.current?.tenants).toEqual([BLUE_MEN]);
        expect(capturedRef.current?.error).toBeNull();
        expect(capturedRef.current?.loading).toBe(false);
        view.unmount();
    });

    it("the cached list renders immediately while the network hangs", async () => {
        localStorage.setItem(TENANTS_CACHE_KEY, JSON.stringify([BLUE_MEN]));
        mocks.listTenants.mockReturnValue(new Promise(() => {}));
        const view = renderTenants();
        await act(async () => {});
        expect(capturedRef.current?.tenants).toEqual([BLUE_MEN]);
        expect(capturedRef.current?.loading).toBe(false);
        view.unmount();
    });

    it("a corrupt cache entry is ignored, the fetch decides", async () => {
        localStorage.setItem(TENANTS_CACHE_KEY, "not-json{");
        mocks.listTenants.mockResolvedValue([BLUE_MEN]);
        const view = renderTenants();
        await act(async () => {});
        expect(capturedRef.current?.tenants).toEqual([BLUE_MEN]);
        view.unmount();
    });
});
