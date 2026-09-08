// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { Base58ID } from "@/lib/id";
import type { UseSSEOptions } from "@/hooks/useSSE";
import { useTableSSE } from "@/hooks/useTableSSE";
import { renderHook } from "./render-hook";
import { ApiError, getTablePromise, isNetworkFailure } from "@/app/api";

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
    getTablePromise: vi.fn(),
    isNetworkFailure: (e: unknown) => e instanceof TypeError,
    ApiError: class extends Error {
        status: number;
        constructor(message: string, status: number) {
            super(message);
            this.status = status;
        }
    },
}));

vi.mock("@/hooks/useSSE", () => ({
    useSSE: vi.fn(),
}));

import { useSSE } from "@/hooks/useSSE";

const pid = (s: string) => s as Base58ID;

/** Captures the onRecover callback passed down to useSSE. */
function captureRecover() {
    let options: UseSSEOptions | undefined;
    vi.mocked(useSSE).mockImplementation(
        ((_url: unknown, opts?: UseSSEOptions) => {
            options = opts;
            return true;
        }) as typeof useSSE,
    );
    return {
        get recover() {
            return options?.onRecover;
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("useTableSSE table-gone detection", () => {
    it("a 404 marks the table gone", async () => {
        const sse = captureRecover();
        vi.mocked(getTablePromise).mockRejectedValue(new ApiError("table not found", 404));
        const onTableGone = vi.fn();

        renderHook(() => useTableSSE(pid("t1"), { onTableGone }));
        await act(async () => {
            await sse.recover!();
        });

        expect(onTableGone).toHaveBeenCalledTimes(1);
    });

    it("a network failure keeps the session — offline is not 'table gone'", async () => {
        const sse = captureRecover();
        vi.mocked(getTablePromise).mockRejectedValue(new TypeError("fetch failed"));
        const onTableGone = vi.fn();

        renderHook(() => useTableSSE(pid("t1"), { onTableGone }));
        await act(async () => {
            await sse.recover!();
            await sse.recover!();
        });

        expect(onTableGone).not.toHaveBeenCalled();
    });

    it("a transient 5xx keeps the session", async () => {
        const sse = captureRecover();
        vi.mocked(getTablePromise).mockRejectedValue(new ApiError("boom", 502));
        const onTableGone = vi.fn();

        renderHook(() => useTableSSE(pid("t1"), { onTableGone }));
        await act(async () => {
            await sse.recover!();
        });

        expect(onTableGone).not.toHaveBeenCalled();
    });

    it("latches: a network failure does not suppress a later real 404", async () => {
        const sse = captureRecover();
        vi.mocked(getTablePromise)
            .mockRejectedValueOnce(new TypeError("fetch failed"))
            .mockRejectedValueOnce(new ApiError("table not found", 404));
        const onTableGone = vi.fn();

        renderHook(() => useTableSSE(pid("t1"), { onTableGone }));
        await act(async () => {
            await sse.recover!();
            await sse.recover!();
        });

        expect(onTableGone).toHaveBeenCalledTimes(1);
    });

    it("isNetworkFailure is consulted for the offline path", () => {
        expect(isNetworkFailure(new TypeError("x"))).toBe(true);
        expect(isNetworkFailure(new Error("x"))).toBe(false);
    });
});
