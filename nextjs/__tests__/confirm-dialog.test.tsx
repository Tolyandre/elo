// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { useConfirmAction } from "@/components/confirm-dialog";
import { renderHook } from "./render-hook";

describe("useConfirmAction", () => {
    it("opens on trigger and closes after a successful confirm", async () => {
        const action = vi.fn(async () => {});
        const { current, unmount } = renderHook(() => useConfirmAction(action));

        expect(current.value.open).toBe(false);

        act(() => {
            current.value.trigger("target-a");
        });
        expect(current.value.open).toBe(true);
        expect(current.value.target).toBe("target-a");

        act(() => {
            current.value.confirm();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(action).toHaveBeenCalledWith("target-a");
        expect(current.value.open).toBe(false);
        expect(current.value.target).toBeNull();
        expect(current.value.pending).toBe(false);
        unmount();
    });

    it("stays open after a failed confirm so the user can retry", async () => {
        const action = vi.fn(async () => {
            throw new Error("boom");
        });
        const { current, unmount } = renderHook(() => useConfirmAction(action));

        act(() => {
            current.value.trigger("target-a");
        });
        act(() => {
            current.value.confirm();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(current.value.open).toBe(true);
        expect(current.value.target).toBe("target-a");
        expect(current.value.pending).toBe(false);
        unmount();
    });

    it("closing via onOpenChange clears the target", () => {
        const action = vi.fn(async () => {});
        const { current, unmount } = renderHook(() => useConfirmAction(action));

        act(() => {
            current.value.trigger("target-a");
        });
        act(() => {
            current.value.onOpenChange(false);
        });

        expect(current.value.open).toBe(false);
        expect(current.value.target).toBeNull();
        unmount();
    });

    it("ignores confirm while pending or without a target", async () => {
        let resolveFn: () => void = () => {};
        const action = vi.fn(
            () => new Promise<void>((r) => {
                resolveFn = r;
            }),
        );
        const { current, unmount } = renderHook(() => useConfirmAction(action));

        // No target yet — confirm is a no-op.
        act(() => {
            current.value.confirm();
        });
        expect(action).not.toHaveBeenCalled();

        act(() => {
            current.value.trigger("target-a");
        });
        act(() => {
            current.value.confirm();
        });
        expect(action).toHaveBeenCalledTimes(1);

        // Still pending — a second click must not re-run the action.
        act(() => {
            current.value.confirm();
        });
        expect(action).toHaveBeenCalledTimes(1);

        resolveFn();
        await act(async () => {
            await Promise.resolve();
        });
        unmount();
    });
});
