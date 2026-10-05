// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import type { SkullKingGameState, TableGameState, TableSummary } from "@/app/api";
import { ActiveTables } from "@/components/tables/active-tables";
import { pid, makeSkullKingState, makeTable } from "./test-utils";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));

function lobbyTable(): TableSummary {
    return makeTable({
        id: pid("tableSk1"),
        host_user_id: pid("userHost"),
        game_state: makeSkullKingState({
            players: [
                { id: pid("playerA"), name: "Аня" },
                { id: pid("playerB"), name: "Боря" },
            ],
        }) satisfies SkullKingGameState as TableGameState,
    });
}

type Me = { isAuthenticated: boolean; playerId: Base58ID | undefined; id?: string };

function renderLobby(me: Me) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<ActiveTables tables={[lobbyTable()]} me={me} />);
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
        expect(mocks.push).toHaveBeenCalledWith("/matches/table?id=tableSk1");
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
