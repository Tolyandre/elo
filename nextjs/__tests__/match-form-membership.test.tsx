// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { MatchForm } from "@/app/matches/MatchForm";
import { pid } from "./test-utils";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    submitMatch: vi.fn(),
}));

// The tenant the match is created under (ADR-36); tests mutate this to
// exercise the openness rules in create and edit modes — since phase 7 the
// rule binds both (the server rejects guest-carrying rosters under
// members_only on either path).
const tenantScope = vi.hoisted(() => ({
    tenant: null as { id: string; name: string; arena_membership_mode: "all" | "any_member" | "members_only" } | null,
    memberIds: [] as string[],
    membersKnown: true,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/app/api", async () => {
    const { mockApiModule } = await import("./test-utils");
    return mockApiModule({ updateMatchPromise: vi.fn() });
});

vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: vi.fn(),
}));

vi.mock("@/app/gamesContext", () => ({
    useGames: vi.fn(),
}));

vi.mock("@/app/matches/MatchesContext", () => ({
    useMatches: vi.fn(),
}));

vi.mock("@/app/meContext", () => ({
    useMe: vi.fn(),
}));

vi.mock("@/app/offline/OfflineContext", () => ({
    useOffline: vi.fn(),
}));

vi.mock("@/app/tenantScopeContext", () => ({
    useTenantScope: () => ({ tenant: tenantScope.tenant, tenantId: tenantScope.tenant?.id ?? null, ready: true }),
    useTenantMembership: () => ({ memberIds: new Set(tenantScope.memberIds), known: tenantScope.membersKnown }),
}));

vi.mock("@/hooks/useCampSelection", () => ({
    useCampSelection: () => ({ active: [], checked: [], toggle: vi.fn(), idsToSubmit: () => [] }),
}));

vi.mock("@/hooks/useTournamentSlotFit", () => ({
    useTournamentSlotFit: () => ({ fits: false, tournamentNames: [] }),
}));

vi.mock("sonner", async () => {
    const { mockSonnerModule } = await import("./test-utils");
    return mockSonnerModule();
});

import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { useMatches } from "@/app/matches/MatchesContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";

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
            <button type="button" data-testid="pick-guests" onClick={() => onChange([pid("g1"), pid("g2")])}>guests</button>
            <button type="button" data-testid="pick-with-member" onClick={() => onChange([pid("g1"), pid("p1")])}>with-member</button>
        </div>
    ),
}));

vi.mock("@/components/game-combobox", () => ({
    GameCombobox: ({ onChange }: { onChange: (id: Base58ID) => void }) => (
            <button type="button" data-testid="pick-game" onClick={() => onChange(pid("game1"))}>game</button>
    ),
}));

vi.mock("@/components/player-name", () => ({
    ClubIcons: () => null,
}));

vi.mocked(usePlayers).mockReturnValue({
    players: [],
    playerMap: new Map(),
    playerDisplayName: (p: { name: string }) => p.name,
    loading: false,
    error: null,
    invalidate: vi.fn(),
} as never);
vi.mocked(useGames).mockReturnValue({ games: [] } as never);
vi.mocked(useMatches).mockReturnValue({ invalidate: vi.fn() } as never);
vi.mocked(useMe).mockReturnValue({ id: "u1", canEdit: true, loading: false } as never);
vi.mocked(useOffline).mockReturnValue({
    pendingPlayers: [],
    pendingGames: [],
    offline: false,
    isSyncing: false,
    submitMatch: mocks.submitMatch,
    updatePendingMatch: vi.fn(),
} as never);

function renderForm() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<MatchForm />);
    });
    const byTestId = (id: string) =>
        container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    return {
        byTestId,
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
                b.textContent?.includes("Сохранить результат"),
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
    mocks.submitMatch.mockResolvedValue(undefined);
});

describe("MatchForm tenant membership rules, create mode (ADR-36)", () => {
    it("any_member: blocks a members-less roster", () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "any_member" };
        tenantScope.memberIds = [pid("p1")];
        const view = renderForm();
        act(() => {
            view.byTestId("pick-game").click();
            view.byTestId("pick-guests").click();
        });
        expect(view.text()).toContain("Нужен хотя бы один участник сообщества «Синие люди»");
        expect(view.submitButton().disabled).toBe(true);
        view.unmount();
    });

    it("any_member: a roster with one member submits", async () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "any_member" };
        tenantScope.memberIds = [pid("p1")];
        const view = renderForm();
        act(() => {
            view.byTestId("pick-game").click();
            view.byTestId("pick-with-member").click();
        });
        expect(view.submitButton().disabled).toBe(false);
        view.submit();
        await act(async () => {});
        expect(mocks.submitMatch).toHaveBeenCalledTimes(1);
        expect(mocks.push).toHaveBeenCalledWith(`/?tenant=${pid("t1")}&tab=feed`);
        view.unmount();
    });

    it("members_only: the picker is restricted to the member set", () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [pid("p1"), pid("p2")];
        const view = renderForm();
        expect(view.byTestId("allowed").textContent).toBe([pid("p1"), pid("p2")].join(","));
        view.unmount();
    });

    it("without a tenant nothing is restricted (the /new hub gates on one)", () => {
        const view = renderForm();
        act(() => {
            view.byTestId("pick-game").click();
            view.byTestId("pick-guests").click();
        });
        expect(view.byTestId("allowed").textContent).toBe("all");
        expect(view.submitButton().disabled).toBe(false);
        view.unmount();
    });

    it("members_only with the club list unavailable: nothing is restricted and the roster submits", async () => {
        // Offline without a cached club list the rule is not checkable — the
        // gate degrades open and the server validates the queued create at
        // sync time instead of the form blocking offline.
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [];
        tenantScope.membersKnown = false;
        const view = renderForm();
        act(() => {
            view.byTestId("pick-game").click();
            view.byTestId("pick-guests").click();
        });
        expect(view.byTestId("allowed").textContent).toBe("all");
        expect(view.text()).not.toContain("только своих участников");
        expect(view.submitButton().disabled).toBe(false);
        view.submit();
        await act(async () => {});
        expect(mocks.submitMatch).toHaveBeenCalledTimes(1);
        view.unmount();
    });
});

describe("MatchForm tenant membership rules, edit mode (ADR-36 phase 7)", () => {
    // An offline-pending match with a guest in the roster: the edit path
    // applies the same openness rule the create path does.
    const pendingWithGuest = {
        clientId: pid("m1"),
        createdAt: "2026-06-01T11:00:00Z",
        status: "pending" as const,
        gameId: pid("game1"),
        score: { [pid("g1")]: 10, [pid("p1")]: 5 },
        campArenaIds: [] as Base58ID[],
    };

    function renderEditForm() {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<MatchForm editPending={pendingWithGuest} />);
        });
        const submitButton = () =>
            Array.from(container.querySelectorAll("button")).find((b) =>
                b.textContent?.includes("Сохранить изменения"),
            ) as HTMLButtonElement;
        return {
            text: () => container.textContent ?? "",
            submitButton,
            unmount() {
                act(() => {
                    root.unmount();
                });
                container.remove();
            },
        };
    }

    it("members_only: a guest-carrying roster is blocked with the reason", () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "members_only" };
        tenantScope.memberIds = [pid("p1"), pid("p2")];
        const view = renderEditForm();
        expect(view.text()).toContain("только своих участников");
        expect(view.submitButton().disabled).toBe(true);
        view.unmount();
    });

    it("all («Все партии»): the same roster submits", async () => {
        tenantScope.tenant = { id: pid("t1"), name: "Синие люди", arena_membership_mode: "all" };
        tenantScope.memberIds = [];
        const view = renderEditForm();
        expect(view.text()).not.toContain("только своих участников");
        expect(view.submitButton().disabled).toBe(false);
        view.unmount();
    });
});
