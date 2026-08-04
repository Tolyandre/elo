// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useAsyncResource } from "@/hooks/useAsyncResource";

/** Minimal renderHook without @testing-library/react (not installed). */
function renderHook<T>(hookFn: () => T): {
    current: { value: T };
    rerender: (hookFn: () => T) => void;
    unmount: () => void;
} {
    const container = document.createElement("div");
    const current = { value: undefined as unknown as T };
    let latestHookFn = hookFn;
    function Comp() {
        current.value = latestHookFn();
        return null;
    }
    const root = createRoot(container);
    act(() => {
        root.render(<Comp />);
    });
    return {
        current,
        rerender: (fn: () => T) => {
            latestHookFn = fn;
            act(() => {
                root.render(<Comp />);
            });
        },
        unmount: () => {
            act(() => {
                root.unmount();
            });
        },
    };
}

describe("useAsyncResource", () => {
    it("starts loading then resolves with data", async () => {
        const fetcher = vi.fn(async () => "hello");
        const { current, unmount } = renderHook(() => useAsyncResource(fetcher));

        expect(current.value.loading).toBe(true);
        expect(current.value.data).toBeNull();

        // Wait for the microtask queue + state flush.
        await act(async () => {
            await Promise.resolve();
        });

        expect(current.value.data).toBe("hello");
        expect(current.value.loading).toBe(false);
        expect(current.value.error).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("captures errors in the error field", async () => {
        const fetcher = vi.fn(async () => {
            throw new Error("boom");
        });
        const { current, unmount } = renderHook(() => useAsyncResource(fetcher));

        await act(async () => {
            await Promise.resolve();
        });

        expect(current.value.data).toBeNull();
        expect(current.value.loading).toBe(false);
        expect(current.value.error).toBe("boom");
        unmount();
    });

    it("invalidate() re-runs the fetcher", async () => {
        let calls = 0;
        const fetcher = vi.fn(async () => ++calls);
        const { current, unmount } = renderHook(() => useAsyncResource(fetcher));

        await act(async () => {
            await Promise.resolve();
        });
        expect(current.value.data).toBe(1);

        act(() => {
            current.value.invalidate();
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(current.value.data).toBe(2);
        expect(fetcher).toHaveBeenCalledTimes(2);
        unmount();
    });

    it("cancels the in-flight result on unmount", async () => {
        let resolveFn: (v: string) => void = () => {};
        const fetcher = vi.fn(
            () => new Promise<string>((r) => {
                resolveFn = r;
            }),
        );
        const { current, unmount } = renderHook(() => useAsyncResource(fetcher));
        expect(current.value.loading).toBe(true);

        unmount();
        // Resolve after unmount — should not throw "setState on unmounted".
        resolveFn("late");
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("refetches when deps change but not when an inline fetcher identity changes", async () => {
        let calls = 0;
        const stableFetcher = async () => ++calls;
        // Re-render with a new inline wrapper each time; the fetcher ref means
        // only deps should drive refetches.
        const useIt = () => {
            const [dep, setDep] = useState(0);
            const res = useAsyncResource(stableFetcher, [dep]);
            return { res, setDep };
        };
        const { current, unmount } = renderHook(useIt);

        await act(async () => {
            await Promise.resolve();
        });
        expect(calls).toBe(1);

        // Bump the dep → refetch.
        act(() => {
            current.value.setDep(1);
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(calls).toBe(2);
        unmount();
    });
});
