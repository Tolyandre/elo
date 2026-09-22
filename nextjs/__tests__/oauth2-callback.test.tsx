// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import Oauth2CallbackClient from "@/app/oauth2-callback/oauth2-callback.client";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    invalidate: vi.fn(),
    oauth2Callback: vi.fn(),
    getMePromise: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
    useSearchParams: () => new URLSearchParams("code=abc&state=ok"),
}));

vi.mock("sonner", () => ({
    toast: Object.assign(vi.fn(), {
        loading: vi.fn(() => "t"),
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("@/app/api", () => ({
    oauth2Callback: (...args: unknown[]) => mocks.oauth2Callback(...args),
    getMePromise: (...args: unknown[]) => mocks.getMePromise(...args),
    EloWebServiceBaseUrl: "http://api.test",
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => ({ invalidate: mocks.invalidate }),
}));

function renderCallback() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<Oauth2CallbackClient />);
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
    vi.clearAllMocks();
});

describe("Oauth2CallbackClient", () => {
    it("signed-in user with a linked player lands on the home page", async () => {
        mocks.oauth2Callback.mockResolvedValue({});
        mocks.getMePromise.mockResolvedValue({ id: "u1", player_id: "p1" });

        const view = renderCallback();
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(mocks.push).toHaveBeenCalledWith("/");
        expect(mocks.invalidate).toHaveBeenCalled();
        view.unmount();
    });

    it("first-time user without a linked player is sent to settings with the hint", async () => {
        mocks.oauth2Callback.mockResolvedValue({});
        mocks.getMePromise.mockResolvedValue({ id: "u1", player_id: null });

        const view = renderCallback();
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(mocks.push).toHaveBeenCalledWith("/settings?link-player=1");
        view.unmount();
    });

    it("a dropped session cookie (401 after success) shows the cross-domain warning", async () => {
        mocks.oauth2Callback.mockResolvedValue({});
        mocks.getMePromise.mockResolvedValue(undefined);

        const view = renderCallback();
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(mocks.push).not.toHaveBeenCalled();
        expect(view.text()).toContain("не сохранил cookie авторизации");
        expect(view.text()).toContain("api.test");
        expect(view.text()).toContain("Войти ещё раз");
        view.unmount();
    });

    it("a transient error while verifying is not reported as a blocked cookie", async () => {
        mocks.oauth2Callback.mockResolvedValue({});
        mocks.getMePromise.mockRejectedValue(new Error("offline"));

        const view = renderCallback();
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(mocks.push).toHaveBeenCalledWith("/");
        expect(view.text()).not.toContain("cookie");
        view.unmount();
    });

    it("a failed callback keeps the error message", async () => {
        mocks.oauth2Callback.mockRejectedValue(new Error("bad code"));

        const view = renderCallback();
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(mocks.push).not.toHaveBeenCalled();
        expect(view.text()).toContain("bad code");
        view.unmount();
    });
});
