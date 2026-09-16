// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

// Enable React's act() environment so hook updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { useUrlQuery, setUrlQuery } from "@/lib/url-state";
import { renderHook } from "./render-hook";

// jsdom queues history traversals as tasks; give them time to land before
// asserting (a bare setTimeout(0) races the traversal).
async function flushHistory() {
    await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("setUrlQuery", () => {
    beforeEach(() => {
        window.history.pushState(null, "", "/elo/arenas/view?id=X&tab=players");
    });

    it("replace: rewrites the query and keeps the pathname (basePath included) and hash", () => {
        window.history.pushState(null, "", "/elo/arenas/view?id=X&tab=players#anchor");
        setUrlQuery((params) => params.set("tab", "matches"));
        expect(window.location.pathname).toBe("/elo/arenas/view");
        expect(window.location.search).toBe("?id=X&tab=matches");
        expect(window.location.hash).toBe("#anchor");
    });

    it("replace: leaves no dangling ? when the query becomes empty", () => {
        setUrlQuery((params) => {
            for (const key of [...params.keys()]) params.delete(key);
        });
        expect(window.location.search).toBe("");
        expect(window.location.href.endsWith("/elo/arenas/view")).toBe(true);
    });

    it("push: creates a history entry; Back restores the previous query", async () => {
        setUrlQuery((params) => params.set("tab", "matches"), "push");
        expect(window.location.search).toBe("?id=X&tab=matches");
        await act(async () => {
            window.history.back();
            await flushHistory();
        });
        expect(window.location.search).toBe("?id=X&tab=players");
    });

    it("replace: overwrites the current entry, so Back skips the update", async () => {
        setUrlQuery((params) => params.set("tab", "matches"), "replace");
        expect(window.location.search).toBe("?id=X&tab=matches");
        await act(async () => {
            window.history.back();
            await flushHistory();
        });
        expect(window.location.search).not.toBe("?id=X&tab=matches");
    });
});

describe("useUrlQuery", () => {
    beforeEach(() => {
        window.history.pushState(null, "", "/elo/arenas/view?id=X&tab=players");
    });

    it("reads the current query and re-renders on setUrlQuery", () => {
        const { current, unmount } = renderHook(() => useUrlQuery());
        expect(current.value.get("tab")).toBe("players");
        act(() => {
            setUrlQuery((params) => params.set("tab", "medals"));
        });
        expect(current.value.get("tab")).toBe("medals");
        unmount();
    });

    it("re-renders on Back/Forward (popstate)", async () => {
        const { current, unmount } = renderHook(() => useUrlQuery());
        act(() => {
            setUrlQuery((params) => params.set("tab", "matches"), "push");
        });
        expect(current.value.get("tab")).toBe("matches");
        await act(async () => {
            window.history.back();
            await flushHistory();
        });
        expect(current.value.get("tab")).toBe("players");
        unmount();
    });
});
