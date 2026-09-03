import { createRoot } from "react-dom/client";
import { act } from "react";

/**
 * Minimal renderHook without @testing-library/react (not installed).
 * Mirrors the helper in use-async-resource.test.tsx.
 */
export function renderHook<T>(hookFn: () => T): {
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
