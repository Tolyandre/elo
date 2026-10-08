// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Shared mutable state the module mocks read from on every render.
const state = vi.hoisted(() => ({
    pathname: "/" as string,
    tenants: [] as { id: string; name: string; club_ids: string[] }[],
    tenantsLoading: false,
    clubs: [] as { id: string; name: string; player_ids: string[]; tenant_id?: string }[],
    clubsLoading: false,
    playerId: undefined as string | undefined,
    meLoading: false,
}));

vi.mock("../app/tenantsContext", () => ({
    useTenants: () => ({ tenants: state.tenants, loading: state.tenantsLoading, invalidate: () => {} }),
}));
vi.mock("../app/clubsContext", () => ({
    useClubs: () => ({ clubs: state.clubs, loading: state.clubsLoading, clubDisplayName: (c: { name: string }) => c.name, clubsForPlayer: () => [], invalidate: () => {} }),
}));
vi.mock("../app/meContext", () => ({
    useMe: () => ({ playerId: state.playerId, loading: state.meLoading }),
}));
// The provider reads the pathname only to decide which pages carry ?tenant=
// in the URL; the tests exercise "/" and "/new" behavior.
vi.mock("next/navigation", () => ({
    usePathname: () => state.pathname,
}));

import { TenantScopeProvider, useTenantScope, type TenantScope } from "../app/tenantScopeContext";
import { encodeId } from "../lib/id";

// Wire-form (Base58) tenant ids — the URL and localStorage branches only
// accept values that survive toBase58ID.
const BLUE_MEN = encodeId("00000000-0000-0000-0000-0000000000b1");
const REDS = encodeId("00000000-0000-0000-0000-0000000000b2");

const tenants = [
    { id: BLUE_MEN, name: "Синие люди", club_ids: ["club-blue"] },
    { id: REDS, name: "Красные", club_ids: ["club-red"] },
];

function setLocation(search: string) {
    window.history.replaceState(null, "", `/${search}`);
}

const capturedRef: { current: TenantScope | undefined } = { current: undefined };
function Probe() {
    const scope = useTenantScope();
    // The capture goes through an effect (the react-hooks lint rightly
    // forbids writing outer variables during render); act() flushes it.
    useEffect(() => {
        capturedRef.current = scope;
    });
    return null;
}

function renderScope() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: ReturnType<typeof createRoot> | undefined;
    act(() => {
        root = createRoot(container);
        root.render(<TenantScopeProvider><Probe /></TenantScopeProvider>);
    });
    return {
        unmount: () => {
            act(() => root!.unmount());
            container.remove();
        },
    };
}

describe("TenantScopeProvider resolution chain (ADR-36)", () => {
    beforeEach(() => {
        setLocation("");
        localStorage.clear();
        state.pathname = "/";
        state.tenants = tenants;
        state.tenantsLoading = false;
        state.clubs = [];
        state.clubsLoading = false;
        state.playerId = undefined;
        state.meLoading = false;
    });

    it("the URL ?tenant= wins over everything", () => {
        state.playerId = "me";
        state.clubs = [{ id: "club-blue", name: "Синие люди", player_ids: ["me"], tenant_id: BLUE_MEN }];
        localStorage.setItem("current-tenant-id", JSON.stringify(REDS));
        setLocation("?tenant=" + BLUE_MEN);

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
        expect(capturedRef.current?.ready).toBe(true);
    });

    it("a garbage ?tenant= is ignored and falls through the chain", () => {
        setLocation("?tenant=not-an-id");
        state.tenants = [tenants[0]];

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
    });

    it("the last displayed tenant (localStorage) outranks the user player's tenant", () => {
        state.playerId = "me";
        state.clubs = [{ id: "club-blue", name: "Синие люди", player_ids: ["me"], tenant_id: BLUE_MEN }];
        localStorage.setItem("current-tenant-id", JSON.stringify(REDS));

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(REDS);
    });

    it("resolves the signed-in user player's tenant via their club", () => {
        state.playerId = "me";
        state.clubs = [{ id: "club-red", name: "Красные", player_ids: ["me"], tenant_id: REDS }];

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(REDS);
    });

    it("auto-selects the only tenant", () => {
        state.tenants = [tenants[0]];

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
    });

    it("stays unresolved (prompt) with several tenants and no signals", async () => {
        const { unmount } = renderScope();
        // Radix mounts the dialog content through a presence tick.
        await act(async () => {
            await Promise.resolve();
        });
        expect(capturedRef.current?.tenantId).toBeNull();
        expect(capturedRef.current?.ready).toBe(true);
        expect(document.body.textContent).toContain("Выберите сообщество");
        unmount();
    });

    it("waits for the identity loads before settling the default", () => {
        state.meLoading = true;

        const { unmount } = renderScope();
        expect(capturedRef.current?.ready).toBe(false);
        unmount();
    });

    it("setTenant persists the choice and puts ?tenant= in the URL", () => {
        setLocation("");

        const { unmount } = renderScope();
        act(() => {
            capturedRef.current!.setTenant(REDS);
        });
        expect(capturedRef.current?.tenantId).toBe(REDS);
        expect(window.location.search).toBe(`?tenant=${REDS}`);
        expect(localStorage.getItem("current-tenant-id")).toBe(JSON.stringify(REDS));
        unmount();
    });

    it("exposes player links carrying the current tenant", () => {
        setLocation("?tenant=" + BLUE_MEN);

        renderScope().unmount();
        expect(capturedRef.current!.playerHref("p1")).toBe(`/players/view?id=p1&tenant=${BLUE_MEN}`);
    });

    it("writes the resolved tenant into the URL on /new (creation names its community)", () => {
        state.pathname = "/new";
        state.tenants = [tenants[0]]; // auto-selected single tenant

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
        expect(window.location.search).toBe(`?tenant=${BLUE_MEN}`);
    });
});
