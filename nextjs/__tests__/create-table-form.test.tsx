// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { CreateTableForm } from "@/components/tables/create-table-form";
import { TABLE_SESSION_KEY } from "@/hooks/useTableSession";
import { GAME_ID_SKULL_KING, GAME_ID_IAWW, TABLE_PAGE_PATH } from "@/lib/game-apps";
import { createTablePromise, type TableGameState, type TableSummary } from "@/app/api";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/app/api", () => ({
    createTablePromise: vi.fn(),
}));

vi.mock("@/app/meContext", () => ({
    useMe: vi.fn(),
}));

vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { useMe } from "@/app/meContext";
import { usePlayers } from "@/app/players/PlayersContext";

const pid = (s: string) => s as Base58ID;

// The picker is a heavy provider-backed component; the form only needs to
// drive the selected id list through it.
vi.mock("@/components/player-multi-select", () => ({
    PlayerMultiSelect: ({ value, onChange }: {
        value: Base58ID[];
        onChange: (ids: Base58ID[]) => void;
    }) => (
        <div>
            <span data-testid="picked-count">{value.length}</span>
            <button data-testid="pick-three" onClick={() => onChange([pid("p1"), pid("p2"), pid("p3")])}>
                pick
            </button>
            <button data-testid="pick-none" onClick={() => onChange([])}>clear</button>
        </div>
    ),
}));

vi.mocked(useMe).mockReturnValue({
    isAuthenticated: true,
    playerId: pid("p1"),
    id: "uMe",
    canEdit: true,
} as never);

vi.mocked(usePlayers).mockReturnValue({
    players: [
        { id: pid("p1"), name: "playerA" },
        { id: pid("p2"), name: "playerB" },
        { id: pid("p3"), name: "playerC" },
    ],
    playerDisplayName: (p: { name: string }) => `Дисплей ${p.name}`,
} as never);

function makeTable(id: string): TableSummary {
    return {
        id: pid(id),
        game_id: GAME_ID_SKULL_KING,
        host_user_id: pid("uMe"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        game_state: {
            phase: "waiting-for-bids",
            players: [],
            currentRound: 1,
            currentPlayerIndex: 0,
            rounds: [],
        },
    };
}

function renderForm() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<CreateTableForm />);
    });
    const byTestId = (id: string) =>
        container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    return {
        byTestId,
        createButton: () =>
            Array.from(container.querySelectorAll("button")).find((b) =>
                b.textContent?.includes("Создать стол"),
            ) as HTMLButtonElement,
        gameButtons: () =>
            Array.from(container.querySelectorAll("button")).filter((b) =>
                ["Skull King", "Этот Безумный Мир"].includes(b.textContent?.trim() ?? ""),
            ),
        orderRows: () =>
            Array.from(container.querySelectorAll("[draggable='true']")).map((r) => r.textContent ?? ""),
        rowEl: (index: number) =>
            container.querySelectorAll("[draggable='true']")[index] as HTMLElement,
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
    localStorage.clear();
    vi.mocked(createTablePromise).mockResolvedValue(makeTable("tNew"));
});

describe("CreateTableForm", () => {
    it("offers both table games with Skull King preselected", () => {
        const view = renderForm();
        expect(view.gameButtons()).toHaveLength(2);
        // The selected game is highlighted via the accent border class.
        const selected = view.gameButtons().find((b) => b.className.includes("border-primary"));
        expect(selected?.textContent?.trim()).toBe("Skull King");
        view.unmount();
    });

    it("create stays disabled until two participants are picked and allowed", () => {
        const view = renderForm();
        expect(view.createButton().disabled).toBe(true);

        act(() => {
            view.byTestId("pick-none").click();
        });
        expect(view.createButton().disabled).toBe(true);

        act(() => {
            view.byTestId("pick-three").click();
        });
        expect(view.byTestId("picked-count").textContent).toBe("3");
        expect(view.createButton().disabled).toBe(false);
        view.unmount();
    });

    it("renders the picked participants in order and reorders them", () => {
        const view = renderForm();
        act(() => {
            view.byTestId("pick-three").click();
        });

        expect(view.orderRows()).toEqual([
            "1. Дисплей playerA",
            "2. Дисплей playerB",
            "3. Дисплей playerC",
        ]);

        // Move the first participant down one seat via its chevron button.
        const row = view.rowEl(0);
        const down = Array.from(row.querySelectorAll("button")).find((b) =>
            b.querySelector(".lucide-chevron-down"),
        ) as HTMLButtonElement;
        act(() => {
            down.click();
        });
        expect(view.orderRows()).toEqual([
            "1. Дисплей playerB",
            "2. Дисплей playerA",
            "3. Дисплей playerC",
        ]);
        view.unmount();
    });

    it("creates the table with the game's initial state and opens it as host", async () => {
        const view = renderForm();
        act(() => {
            view.byTestId("pick-three").click();
        });

        await act(async () => {
            view.createButton().click();
        });

        expect(createTablePromise).toHaveBeenCalledTimes(1);
        const [gameId, state] = vi.mocked(createTablePromise).mock.calls[0] as [Base58ID, TableGameState];
        expect(gameId).toBe(GAME_ID_SKULL_KING);
        // The roster order is the seating order, names resolved for display.
        expect(state.phase).toBe("waiting-for-bids");
        expect(state.players).toEqual([
            { id: pid("p1"), name: "Дисплей playerA" },
            { id: pid("p2"), name: "Дисплей playerB" },
            { id: pid("p3"), name: "Дисплей playerC" },
        ]);

        // The host session is stashed for the tables page to resume, and the
        // page opens with the sticky ?id= binding.
        expect(JSON.parse(localStorage.getItem(TABLE_SESSION_KEY)!)).toEqual({
            tableId: "tNew",
            isHost: true,
            myPlayerIndex: null,
        });
        expect(mocks.push).toHaveBeenCalledWith(`${TABLE_PAGE_PATH}?id=${pid("tNew")}`);
        view.unmount();
    });

    it("passes the selected game through to the created table", async () => {
        const view = renderForm();
        act(() => {
            view.byTestId("pick-three").click();
        });
        act(() => {
            view.gameButtons().find((b) => b.textContent?.trim() === "Этот Безумный Мир")!.click();
        });

        await act(async () => {
            view.createButton().click();
        });

        expect(vi.mocked(createTablePromise).mock.calls[0][0]).toBe(GAME_ID_IAWW);
        const state = vi.mocked(createTablePromise).mock.calls[0][1] as TableGameState;
        expect(state.phase).toBe("scoring");
        view.unmount();
    });

    it("toasts and stays on the form when the server rejects the creation", async () => {
        vi.mocked(createTablePromise).mockRejectedValue(new Error("boom"));
        const view = renderForm();
        act(() => {
            view.byTestId("pick-three").click();
        });

        await act(async () => {
            view.createButton().click();
        });

        expect(toast.error).toHaveBeenCalledWith("Не удалось создать стол: boom");
        expect(mocks.push).not.toHaveBeenCalled();
        expect(localStorage.getItem(TABLE_SESSION_KEY)).toBeNull();
        view.unmount();
    });
});
