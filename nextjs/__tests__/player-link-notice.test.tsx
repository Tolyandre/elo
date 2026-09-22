// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { PlayerLinkNotice } from "@/components/player-link-notice";

const mocks = vi.hoisted(() => ({
    me: {
        id: undefined as string | undefined,
        name: "Danis",
        canEdit: true,
        playerId: undefined as string | undefined,
        isAuthenticated: false,
        loading: false,
    },
}));

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => mocks.me,
}));

function renderNotice(props: { action: string }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<PlayerLinkNotice {...props} />);
    });
    return {
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
    mocks.me = {
        id: undefined,
        name: "Danis",
        canEdit: true,
        playerId: undefined,
        isAuthenticated: false,
        loading: false,
    };
});

describe("PlayerLinkNotice", () => {
    it("anonymous user: asks to log in and link a player, offers the login", () => {
        const view = renderNotice({ action: "записаться на турнир" });
        expect(view.text()).toContain("выполните вход и привяжите своего игрока");
        expect(view.text()).toContain("Мои настройки");
        expect(view.text()).toContain("Войти");
        view.unmount();
    });

    it("signed in without a player: asks to link one and links to the settings page", () => {
        mocks.me = {
            id: "u1",
            name: "Danis",
            canEdit: true,
            playerId: undefined,
            isAuthenticated: true,
            loading: false,
        };
        const view = renderNotice({ action: "записаться на турнир" });
        expect(view.text()).not.toContain("выполните вход");
        expect(view.text()).toContain("привяжите своего игрока");
        expect(view.text()).toContain("Мои настройки");
        view.unmount();
    });

    it("signed in with a linked player: renders nothing", () => {
        mocks.me = {
            id: "u1",
            name: "Danis",
            canEdit: true,
            playerId: "p1" as never,
            isAuthenticated: true,
            loading: false,
        };
        const view = renderNotice({ action: "записаться на турнир" });
        expect(view.text()).toBe("");
        view.unmount();
    });

    it("identity still loading: renders nothing (no login flash)", () => {
        mocks.me = { ...mocks.me, loading: true };
        const view = renderNotice({ action: "записаться на турнир" });
        expect(view.text()).toBe("");
        view.unmount();
    });
});
