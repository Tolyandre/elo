// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { GAME_ID_SKULL_KING } from "@/lib/game-apps";
import type { SkullKingGameState, TableGameState, TableSummary } from "@/app/api";
import { ActiveTables } from "@/components/tables/active-tables";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));

const pid = (s: string) => s as Base58ID;

function skState(players: { id: Base58ID; name: string }[]): SkullKingGameState {
    return {
        phase: "waiting-for-bids",
        players,
        currentRound: 2,
        currentPlayerIndex: 0,
        rounds: [],
    };
}

function makeTable(): TableSummary {
    return {
        id: pid("tableSk1"),
        game_id: GAME_ID_SKULL_KING,
        host_user_id: pid("userHost"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        game_state: skState([
            { id: pid("playerA"), name: "Аня" },
            { id: pid("playerB"), name: "Боря" },
        ]) satisfies SkullKingGameState as TableGameState,
    };
}

type Me = { isAuthenticated: boolean; playerId: Base58ID | undefined; id?: string };

function renderLobby(me: Me) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<ActiveTables tables={[makeTable()]} me={me} />);
    });
    return {
        button: () => {
            const buttons = Array.from(container.querySelectorAll("button")).filter(
                (b) => b.textContent?.trim() !== "",
            );
            return buttons[0] as HTMLButtonElement;
        },
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
});

describe("ActiveTables entry buttons", () => {
    it("a signed-out visitor can enter the table as a viewer", () => {
        const view = renderLobby({ isAuthenticated: false, playerId: undefined });

        const button = view.button();
        expect(button.textContent).toBe("Смотреть");
        expect(button.disabled).toBe(false);
        expect(view.text()).toContain("только для просмотра");

        act(() => {
            button.click();
        });
        expect(mocks.push).toHaveBeenCalledWith("/matches/table/skull-king?table=tableSk1");
        view.unmount();
    });

    it("an authenticated user without a linked player also enters as a viewer", () => {
        const view = renderLobby({ isAuthenticated: true, playerId: undefined });

        const button = view.button();
        expect(button.textContent).toBe("Смотреть");
        expect(button.disabled).toBe(false);
        expect(view.text()).toContain("Привяжите аккаунт к игроку");
        view.unmount();
    });

    it("a linked player enters with Войти", () => {
        const view = renderLobby({ isAuthenticated: true, playerId: pid("playerMe") });

        const button = view.button();
        expect(button.textContent).toBe("Войти");
        expect(button.disabled).toBe(false);
        view.unmount();
    });

    it("the host gets Вернуться", () => {
        const view = renderLobby({ isAuthenticated: true, playerId: pid("playerMe"), id: "userHost" });

        expect(view.button().textContent).toBe("Вернуться");
        view.unmount();
    });
});
