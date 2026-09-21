// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { SwUpdateChip } from "@/components/sw-update-chip";
import { parseSwMessage } from "@/lib/sw-messages";

// jsdom has no service worker container; the chip only talks to this surface.
class FakeServiceWorkerContainer extends EventTarget {
    controller: unknown = { scriptURL: "/sw.js" };
    installing: unknown = null;
    getRegistration = async () => ({ installing: this.installing });
    dispatch(type: string, data?: unknown) {
        act(() => {
            this.dispatchEvent(
                data === undefined
                    ? new Event(type)
                    : new MessageEvent(type, { data }),
            );
        });
    }
}

let sw: FakeServiceWorkerContainer;

function renderChip() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<SwUpdateChip />);
    });
    return {
        text: () => container.textContent ?? "",
        trigger: () => container.querySelector("button"),
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

beforeEach(() => {
    sw = new FakeServiceWorkerContainer();
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true, writable: true });
});

afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("SwUpdateChip", () => {
    it("renders nothing while no update is installing", () => {
        const view = renderChip();
        expect(view.trigger()).toBeNull();
        view.unmount();
    });

    it("ignores messages that are not precache progress", () => {
        const view = renderChip();
        sw.dispatch("message", { type: "api-served-from-cache", url: "http://api/players" });
        sw.dispatch("message", "garbage");
        sw.dispatch("message", { type: "sw-precache-progress", done: "1", total: 2 });
        expect(view.trigger()).toBeNull();
        view.unmount();
    });

    it("shows the download percent from progress messages", () => {
        const view = renderChip();
        sw.dispatch("message", { type: "sw-precache-progress", done: 84, total: 200 });
        expect(view.text()).toContain("42%");
        view.unmount();
    });

    it("shows an indeterminate spinner while an install is running but no entry has completed", async () => {
        sw.installing = { scriptURL: "/sw.js" };
        const view = renderChip();
        await act(async () => {}); // flush getRegistration()
        expect(view.trigger()).not.toBeNull();
        expect(view.text()).not.toContain("%");
        view.unmount();
    });

    it("hides itself shortly after the download completes", () => {
        vi.useFakeTimers();
        try {
            const view = renderChip();
            sw.dispatch("message", { type: "sw-precache-progress", done: 200, total: 200 });
            expect(view.text()).toContain("100%");
            act(() => {
                vi.advanceTimersByTime(3000);
            });
            expect(view.trigger()).toBeNull();
            view.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("hides immediately when a new worker takes control", () => {
        const view = renderChip();
        sw.dispatch("message", { type: "sw-precache-progress", done: 5, total: 200 });
        expect(view.trigger()).not.toBeNull();
        sw.dispatch("controllerchange");
        expect(view.trigger()).toBeNull();
        view.unmount();
    });
});

// Sanity: the guard the chip relies on for payload validation.
describe("chip message contract", () => {
    it("accepts the exact payloads the worker posts", () => {
        expect(parseSwMessage({ type: "sw-precache-progress", done: 0, total: 0 })).toEqual({
            type: "sw-precache-progress",
            done: 0,
            total: 0,
        });
    });
});
