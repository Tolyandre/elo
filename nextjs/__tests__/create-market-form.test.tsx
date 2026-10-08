// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { CreateMarketForm } from "@/components/markets/create-market-form";
import { createMarketPromise } from "@/app/api";
import { pid } from "./test-utils";

// The «Тип рынка» Radix Select tracks its trigger's size — a jsdom gap.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
}));

// The tenant the form creates under (ADR-36) — from the URL's scope, not a
// form field; tests mutate this to exercise the openness rules.
const tenantScope = vi.hoisted(() => ({
    tenant: null as { id: string; name: string; arena_membership_mode: "any_member" | "members_only" } | null,
    memberIds: [] as string[],
    membersKnown: true,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/app/api", async () => {
    const { mockApiModule } = await import("./test-utils");
    return mockApiModule({ createMarketPromise: vi.fn() });
});

vi.mock("@/app/meContext", () => ({
    useMe: vi.fn(),
}));

vi.mock("@/app/tenantScopeContext", () => ({
    useTenantScope: () => ({ tenant: tenantScope.tenant, tenantId: tenantScope.tenant?.id ?? null, ready: true }),
    useTenantMembership: () => ({ memberIds: new Set(tenantScope.memberIds), known: tenantScope.membersKnown }),
}));

vi.mock("sonner", async () => {
    const { mockSonnerModule } = await import("./test-utils");
    return mockSonnerModule();
});

import { useMe } from "@/app/meContext";

// The pickers are heavy provider-backed components; the form drives their id
// lists — and must receive the member restriction in members_only tenants.
vi.mock("@/components/player-multi-select", () => ({
    PlayerMultiSelect: ({ value, onChange, allowedPlayerIds }: {
        value: Base58ID[];
        onChange: (ids: Base58ID[]) => void;
        allowedPlayerIds?: string[];
    }) => (
        <div>
            <span data-testid="picked">{value.join(",")}</span>
            <span data-testid="allowed">{allowedPlayerIds ? allowedPlayerIds.join(",") : "all"}</span>
            <button type="button" data-testid="pick" onClick={() => onChange([pid("p1"), pid("g1")])}>pick</button>
        </div>
    ),
}));

vi.mock("@/components/player-combobox", () => ({
    PlayerCombobox: ({ value, onChange, allowedPlayerIds }: {
        value?: Base58ID;
        onChange: (id?: Base58ID) => void;
        allowedPlayerIds?: string[];
    }) => (
        <div>
            <span data-testid="streak-allowed">{allowedPlayerIds ? allowedPlayerIds.join(",") : "all"}</span>
            <span data-testid="streak-value">{value ?? ""}</span>
            <button type="button" data-testid="streak-pick" onClick={() => onChange(pid("g1"))}>streak</button>
        </div>
    ),
}));

vi.mock("@/components/game-multi-select", () => ({
    GameMultiSelect: () => <div />,
}));

vi.mock("@/components/resolution-description", () => ({
    ResolutionDescription: () => <div />,
}));

vi.mocked(useMe).mockReturnValue({ canEdit: true } as never);

function renderForm() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<CreateMarketForm />);
    });
    const byTestId = (id: string) =>
        container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const setCloseAt = (value: string) => {
        const input = container.querySelector<HTMLInputElement>("#closes_at")!;
        const setValue = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
        )!.set!;
        act(() => {
            setValue.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    };
    return {
        byTestId,
        setCloseAt,
        submit: () => {
            // jsdom does not turn a submit-button click into a submit event;
            // React's onSubmit listens for the event itself.
            const form = container.querySelector("form")!;
            act(() => {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            });
        },
        submitButton: () =>
            Array.from(container.querySelectorAll("button")).find((b) =>
                b.textContent?.includes("Создать"),
            ) as HTMLButtonElement,
        text: () => container.textContent ?? "",
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    tenantScope.tenant = null;
    tenantScope.memberIds = [];
    tenantScope.membersKnown = true;
    vi.mocked(createMarketPromise).mockResolvedValue({ id: pid("m1") });
});

describe("CreateMarketForm", () => {
    it("shows the scoped community and creates under it, landing on its feed", async () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "any_member" };
        const view = renderForm();
        expect(view.text()).toContain("Сообщество:");
        expect(view.text()).toContain("Синие люди");

        view.setCloseAt("2026-10-10T12:00");
        act(() => {
            view.byTestId("pick").click();
        });
        view.submit();
        await act(async () => {});

        expect(createMarketPromise).toHaveBeenCalledWith(
            pid("t1"),
            expect.objectContaining({
                market_type: "match_winner",
                target_player_ids: [pid("p1"), pid("g1")],
            }),
        );
        expect(mocks.push).toHaveBeenCalledWith(`/?tenant=${pid("t1")}&tab=feed`);
        view.unmount();
    });

    it("members_only: both target pickers are restricted to the member set", () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [pid("p1"), pid("p2")];
        const view = renderForm();
        expect(view.byTestId("allowed").textContent).toBe([pid("p1"), pid("p2")].join(","));

        // win_streak: switch the stored market type and re-check.
        sessionStorage.setItem("new-market/marketType", JSON.stringify("win_streak"));
        view.unmount();
        const streakView = renderForm();
        expect(streakView.byTestId("streak-allowed").textContent).toBe([pid("p1"), pid("p2")].join(","));
        streakView.unmount();
    });

    it("members_only: a stray non-member in the draft blocks the submit", () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [pid("p1")];
        const view = renderForm();
        view.setCloseAt("2026-10-10T12:00");
        act(() => {
            view.byTestId("pick").click(); // p1 (member) + g1 (guest)
        });
        expect(view.submitButton().disabled).toBe(true);
        expect(view.text()).toContain("только своих участников");
        view.unmount();
    });

    it("any_member: guests together with a member pass without an issue", async () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "any_member" };
        tenantScope.memberIds = [pid("p1")];
        const view = renderForm();
        view.setCloseAt("2026-10-10T12:00");
        act(() => {
            view.byTestId("pick").click();
        });
        expect(view.submitButton().disabled).toBe(false);
        view.submit();
        await act(async () => {});
        expect(createMarketPromise).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it("members_only with the club list unavailable: pickers open up and the submit passes", async () => {
        // Offline without a cached club list the rule is not checkable — the
        // gate degrades open and the server validates the market at sync time.
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [];
        tenantScope.membersKnown = false;
        const view = renderForm();
        expect(view.byTestId("allowed").textContent).toBe("all");
        view.setCloseAt("2026-10-10T12:00");
        act(() => {
            view.byTestId("pick").click(); // p1 (member) + g1 (guest)
        });
        expect(view.text()).not.toContain("только своих участников");
        expect(view.submitButton().disabled).toBe(false);
        view.submit();
        await act(async () => {});
        expect(createMarketPromise).toHaveBeenCalledTimes(1);
        view.unmount();
    });
});
