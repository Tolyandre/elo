// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { renderHook } from "./render-hook";

const PREF_KEY = "wake-lock/enabled";

function installWakeLock() {
    const releaseListeners: ((event: string) => void)[] = [];
    const sentinel = {
        addEventListener: vi.fn((_type: string, cb: (event: string) => void) => releaseListeners.push(cb)),
        release: vi.fn(async () => {}),
    };
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", {
        value: { request },
        configurable: true,
    });
    return { request, sentinel, releaseListeners };
}

beforeEach(() => {
    localStorage.clear();
});

describe("useWakeLock", () => {
    it("a manual toggle persists the preference", async () => {
        const { request } = installWakeLock();
        const h = renderHook(() => useWakeLock());
        expect(h.current.value.supported).toBe(true);

        await act(async () => {
            await h.current.value.toggle();
        });
        expect(request).toHaveBeenCalledTimes(1);
        expect(h.current.value.enabled).toBe(true);
        expect(localStorage.getItem(PREF_KEY)).toBe("true");

        await act(async () => {
            await h.current.value.toggle();
        });
        expect(h.current.value.enabled).toBe(false);
        expect(localStorage.getItem(PREF_KEY)).toBe("false");
    });

    it("re-acquires on mount when the stored preference is on", async () => {
        const { request } = installWakeLock();
        localStorage.setItem(PREF_KEY, "true");

        const h = renderHook(() => useWakeLock());
        await act(async () => {
            await Promise.resolve();
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(h.current.value.enabled).toBe(true);
    });

    it("stays off on mount without a stored preference", async () => {
        const { request } = installWakeLock();
        const h = renderHook(() => useWakeLock());
        await act(async () => {
            await Promise.resolve();
        });
        expect(request).not.toHaveBeenCalled();
        expect(h.current.value.enabled).toBe(false);
    });
});
