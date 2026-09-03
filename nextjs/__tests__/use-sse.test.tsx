// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useSSE } from "@/hooks/useSSE";
import { renderHook } from "./render-hook";

const LIVENESS_MS = 45_000;
const RETRY_BASE_MS = 1_000;

type Listener = (event: { data?: string }) => void;

class FakeEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    static instances: FakeEventSource[] = [];

    url: string;
    readyState = 0;
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private listeners = new Map<string, Listener[]>();

    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: Listener) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    close() {
        this.closed = true;
        this.readyState = FakeEventSource.CLOSED;
    }

    // ── test helpers ──
    simulateOpen() {
        this.readyState = FakeEventSource.OPEN;
        this.onopen?.();
    }

    simulateMessage(envelope: unknown) {
        this.onmessage?.({ data: JSON.stringify(envelope) });
    }

    simulateHeartbeat() {
        for (const listener of this.listeners.get("heartbeat") ?? []) {
            listener({ data: String(Math.floor(Date.now() / 1000)) });
        }
    }

    /** Connection dropped — readyState stays CONNECTING, browser retries. */
    simulateNetworkError() {
        this.readyState = FakeEventSource.CONNECTING;
        this.onerror?.();
    }

    /** Server rejected the connection (non-200) — browser gives up. */
    simulateRejection() {
        this.readyState = FakeEventSource.CLOSED;
        this.onerror?.();
    }

    latestInstance() {
        return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
}

describe("useSSE", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeEventSource.instances = [];
        vi.stubGlobal("EventSource", FakeEventSource);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("dispatches parsed data frames to onEvent", () => {
        const onEvent = vi.fn();
        renderHook(() => useSSE("http://x/events", { onEvent }));
        const es = FakeEventSource.instances[0];
        es.simulateMessage({ type: "state", data: { id: "abc" } });
        expect(onEvent).toHaveBeenCalledWith({ type: "state", data: { id: "abc" } });
    });

    it("named heartbeat events re-arm the liveness watchdog (comment frames cannot)", () => {
        const onEvent = vi.fn();
        renderHook(() => useSSE("http://x/events", { onEvent }));
        const first = FakeEventSource.instances[0];
        first.simulateOpen();

        // Healthy but idle: only heartbeats arrive. The old implementation
        // never saw them and tore the connection down every 45s.
        for (let t = 0; t < 3 * LIVENESS_MS; t += 15_000) {
            vi.advanceTimersByTime(15_000);
            first.simulateHeartbeat();
        }
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(first.closed).toBe(false);
    });

    it("recreates the EventSource when no frames at all arrive within the liveness window", () => {
        const onRecover = vi.fn();
        renderHook(() => useSSE("http://x/events", { onEvent: vi.fn(), onRecover }));
        const first = FakeEventSource.instances[0];
        first.simulateOpen();

        vi.advanceTimersByTime(LIVENESS_MS + 1);

        expect(first.closed).toBe(true);
        expect(FakeEventSource.instances).toHaveLength(2);
        // The recreate is a gap: the next open must trigger catch-up.
        FakeEventSource.instances[1].simulateOpen();
        expect(onRecover).toHaveBeenCalledTimes(1);
    });

    it("fires onRecover when the stream reopens after a network error", () => {
        const onRecover = vi.fn();
        renderHook(() => useSSE("http://x/events", { onEvent: vi.fn(), onRecover }));
        const first = FakeEventSource.instances[0];
        first.simulateOpen();
        first.simulateNetworkError();
        expect(onRecover).not.toHaveBeenCalled();

        first.simulateOpen(); // browser auto-reconnect succeeded
        expect(onRecover).toHaveBeenCalledTimes(1);
    });

    it("probes via onRecover and retries with backoff when the server rejects the connection", () => {
        const onRecover = vi.fn();
        renderHook(() => useSSE("http://x/events", { onEvent: vi.fn(), onRecover }));
        const first = FakeEventSource.instances[0];
        first.simulateRejection();

        // A rejected connection never fires onopen, so the probe must come
        // straight from the rejection — this is how a deleted table is
        // detected (the consumer's recovery fetch 404s and it unsubscribes).
        expect(onRecover).toHaveBeenCalledTimes(1);
        expect(FakeEventSource.instances).toHaveLength(1);

        // First retry after the base delay, with exponential growth after.
        vi.advanceTimersByTime(RETRY_BASE_MS - 1);
        expect(FakeEventSource.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeEventSource.instances).toHaveLength(2);

        FakeEventSource.instances[1].simulateRejection();
        vi.advanceTimersByTime(RETRY_BASE_MS * 2);
        expect(FakeEventSource.instances).toHaveLength(3);
    });

    it("stops retrying once the consumer unsubscribes (url → null)", () => {
        const onRecover = vi.fn();
        let url: string | null = "http://x/events";
        const rendered = renderHook(() => useSSE(url, { onEvent: vi.fn(), onRecover }));
        const first = FakeEventSource.instances[0];
        first.simulateRejection();

        url = null;
        rendered.rerender(() => useSSE(url, { onEvent: vi.fn(), onRecover }));
        vi.advanceTimersByTime(60_000);

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(first.closed).toBe(true);
    });
});
