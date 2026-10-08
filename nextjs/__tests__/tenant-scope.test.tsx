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
}));

vi.mock("../app/tenantsContext", () => ({
    useTenants: () => ({ tenants: state.tenants, loading: state.tenantsLoading, invalidate: () => {} }),
}));
vi.mock("../app/clubsContext", () => ({
    useClubs: () => ({ clubs: state.clubs, loading: state.clubsLoading, clubDisplayName: (c: { name: string }) => c.name, clubsForPlayer: () => [], invalidate: () => {} }),
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

describe("TenantScopeProvider resolution chain (ADR-36, explicit only)", () => {
    beforeEach(() => {
        setLocation("");
        localStorage.clear();
        state.pathname = "/";
        state.tenants = tenants;
        state.tenantsLoading = false;
        state.clubs = [];
        state.clubsLoading = false;
    });

    it("the URL ?tenant= wins over everything", () => {
        localStorage.setItem("current-tenant-id", JSON.stringify(REDS));
        setLocation("?tenant=" + BLUE_MEN);

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
        expect(capturedRef.current?.ready).toBe(true);
    });

    it("a garbage ?tenant= is ignored and falls through the chain", () => {
        setLocation("?tenant=not-an-id");
        localStorage.setItem("current-tenant-id", JSON.stringify(BLUE_MEN));

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
    });

    it("resolves the stored choice without any loads", () => {
        localStorage.setItem("current-tenant-id", JSON.stringify(REDS));

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(REDS);
        expect(capturedRef.current?.ready).toBe(true);
    });

    it("does not default to the signed-in user player's tenant (explicit only)", () => {
        // A club membership used to auto-resolve the tenant; since phase 7
        // the chain stops — the pages show the chooser instead.
        state.clubs = [{ id: "club-red", name: "Красные", player_ids: ["me"], tenant_id: REDS }];

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBeNull();
        expect(capturedRef.current?.ready).toBe(true);
    });

    it("does not auto-select the only tenant", () => {
        state.tenants = [tenants[0]];

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBeNull();
        expect(capturedRef.current?.ready).toBe(true);
    });

    it("resolves to nothing with no signals — pages render the chooser themselves", () => {
        const { unmount } = renderScope();
        expect(capturedRef.current?.tenantId).toBeNull();
        expect(capturedRef.current?.ready).toBe(true);
        // No auto-popup dialog anymore: the provider renders no UI at all.
        expect(document.body.textContent).not.toContain("Выберите сообщество");
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

    it("writes the stored tenant into the URL on /new (creation names its community)", () => {
        state.pathname = "/new";
        localStorage.setItem("current-tenant-id", JSON.stringify(BLUE_MEN));

        renderScope().unmount();
        expect(capturedRef.current?.tenantId).toBe(BLUE_MEN);
        expect(window.location.search).toBe(`?tenant=${BLUE_MEN}`);
    });
});
