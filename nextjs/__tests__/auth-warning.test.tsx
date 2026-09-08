// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthWarning } from "@/components/auth-warning";

const mocks = vi.hoisted(() => ({
    me: {
        id: undefined as string | undefined,
        name: "Danis",
        canEdit: true,
        loading: false,
    },
}));

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => mocks.me,
}));

function renderWarning(props: { table?: boolean } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<AuthWarning {...props} />);
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
    mocks.me = { id: undefined, name: "Danis", canEdit: true, loading: false };
});

describe("AuthWarning", () => {
    it("default variant: the offline-queue note still applies to the manual form", () => {
        const view = renderWarning();
        expect(view.text()).toContain("Для сохранения партии потребуется выполнить вход");
        expect(view.text()).toContain("Результаты временно хранятся в браузере");
        view.unmount();
    });

    it("table variant: game state is server-only, so no browser-storage note", () => {
        const view = renderWarning({ table: true });
        expect(view.text()).toContain("Чтобы создать стол, выполните вход");
        expect(view.text()).not.toContain("Результаты временно хранятся в браузере");
        view.unmount();
    });

    it("a signed-in editor gets no warning", () => {
        mocks.me = { id: "u1", name: "Danis", canEdit: true, loading: false };
        const view = renderWarning({ table: true });
        expect(view.text()).toBe("");
        view.unmount();
    });
});
