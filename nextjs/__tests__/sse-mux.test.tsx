// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Enable React's act() environment so async state updates don't warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
}));

import { subscribeTopic } from "@/lib/sse-mux";
import { useSSETopic } from "@/hooks/useSSETopic";
import { renderHook } from "./render-hook";
import { act } from "react";

const LIVENESS_MS = 45_000;

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

    /** Named SSE event (a multiplexed topic frame or the heartbeat). */
    simulateNamed(type: string, payload: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data: payload });
        }
    }

    simulateTopicFrame(topic: string, envelope: unknown) {
        this.simulateNamed(topic, JSON.stringify(envelope));
    }

    /** Connection dropped — readyState stays CONNECTING, browser retries. */
    simulateNetworkError() {
        this.readyState = FakeEventSource.CONNECTING;
        this.onerror?.();
    }

    latestInstance() {
        return FakeEventSource.instances[FakeEventSource.instances.length - 1];
    }
}

describe("sse-mux", () => {
    let unsubs: (() => void)[];
    const subscribe = (...args: Parameters<typeof subscribeTopic>) => {
        const unsub = subscribeTopic(...args);
        unsubs.push(unsub);
        return unsub;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        FakeEventSource.instances = [];
        vi.stubGlobal("EventSource", FakeEventSource);
        unsubs = [];
    });

    afterEach(() => {
        for (const unsub of unsubs) unsub();
        unsubs = [];
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("opens one connection carrying the sorted topic set", () => {
        subscribe("lobby:tables", { onEvent: vi.fn() });
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].url).toBe("http://api.test/events?topics=lobby:tables");

        subscribe("data", { onEvent: vi.fn() });
        expect(FakeEventSource.instances[0].closed).toBe(true);
        expect(FakeEventSource.instances).toHaveLength(2);
        expect(FakeEventSource.instances[1].url).toBe("http://api.test/events?topics=data,lobby:tables");
    });

    it("dispatches topic frames only to that topic's subscribers", () => {
        const onData = vi.fn();
        const onLobby = vi.fn();
        subscribe("data", { onEvent: onData });
        subscribe("lobby:tables", { onEvent: onLobby });
        const es = FakeEventSource.instances[1];

        es.simulateTopicFrame("data", { type: "players-changed" });
        es.simulateTopicFrame("lobby:tables", { type: "tables-changed" });
        es.simulateNamed("data", "not-json");

        expect(onData).toHaveBeenCalledTimes(1);
        expect(onData).toHaveBeenCalledWith({ type: "players-changed" });
        expect(onLobby).toHaveBeenCalledTimes(1);
        expect(onLobby).toHaveBeenCalledWith({ type: "tables-changed" });
    });

    it("fans recover out to every subscriber when the stream reopens after a gap", () => {
        const recoverA = vi.fn();
        const recoverB = vi.fn();
        subscribe("data", { onEvent: vi.fn(), onRecover: recoverA });
        subscribe("lobby:markets", { onEvent: vi.fn(), onRecover: recoverB });
        // Subscribing the second topic switched the stream — the switch
        // itself fans one recover out to everyone (asserted in detail in its
        // own test below).
        expect(recoverA).toHaveBeenCalledTimes(1);
        expect(recoverB).toHaveBeenCalledTimes(1);

        const es = FakeEventSource.instances[1];
        es.simulateOpen(); // clean open of the new stream: no extra recover
        expect(recoverA).toHaveBeenCalledTimes(1);

        es.simulateNetworkError();
        es.simulateOpen(); // browser auto-reconnect succeeded
        expect(recoverA).toHaveBeenCalledTimes(2);
        expect(recoverB).toHaveBeenCalledTimes(2);
    });

    it("fans recover out when a topic-set change switches the stream", () => {
        const recoverA = vi.fn();
        subscribe("data", { onEvent: vi.fn(), onRecover: recoverA });

        subscribe("me", { onEvent: vi.fn() });

        // The staying subscriber must catch up on the reconnect gap even
        // though the new engine never observed an error itself.
        expect(recoverA).toHaveBeenCalledTimes(1);
    });

    it("does not fire recover on a clean first connect", () => {
        const recover = vi.fn();
        subscribe("data", { onEvent: vi.fn(), onRecover: recover });
        FakeEventSource.instances[0].simulateOpen();
        expect(recover).not.toHaveBeenCalled();
    });

    it("keeps the connection alive on named heartbeats and tears it down with the last unsubscribe", () => {
        subscribe("data", { onEvent: vi.fn() });
        const es = FakeEventSource.instances[0];
        es.simulateOpen();
        for (let t = 0; t < 3 * LIVENESS_MS; t += 15_000) {
            vi.advanceTimersByTime(15_000);
            es.simulateNamed("heartbeat", String(Math.floor(Date.now() / 1000)));
        }
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(es.closed).toBe(false);

        // Rejected connection → the engine schedules a retry; unsubscribing
        // must stop it.
        es.simulateNetworkError();
        es.readyState = FakeEventSource.CLOSED;
        es.onerror?.();
        unsubs[0]();

        vi.advanceTimersByTime(60_000);
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(es.closed).toBe(true);
    });
});

describe("useSSETopic", () => {
    let unsubs: (() => void)[];

    beforeEach(() => {
        vi.useFakeTimers();
        FakeEventSource.instances = [];
        vi.stubGlobal("EventSource", FakeEventSource);
        unsubs = [];
    });

    afterEach(() => {
        for (const unsub of unsubs) unsub();
        unsubs = [];
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("mirrors the shared connection state and unsubscribes on unmount", () => {
        const onEvent = vi.fn();
        const rendered = renderHook(() => useSSETopic("data", { onEvent }));
        expect(rendered.current.value).toBe(false);

        const es = FakeEventSource.instances[0];
        act(() => {
            es.simulateOpen();
        });
        expect(rendered.current.value).toBe(true);

        es.simulateTopicFrame("data", { type: "matches-changed" });
        expect(onEvent).toHaveBeenCalledWith({ type: "matches-changed" });

        rendered.unmount();
        expect(es.closed).toBe(true);
    });

    it("unsubscribes when the topic turns null (signed out) and resubscribes on change", () => {
        let topic: string | null = "me";
        const rendered = renderHook(() => useSSETopic(topic, { onEvent: vi.fn() }));
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].url).toBe("http://api.test/events?topics=me");

        topic = null;
        rendered.rerender(() => useSSETopic(topic, { onEvent: vi.fn() }));
        expect(FakeEventSource.instances[0].closed).toBe(true);

        topic = "data";
        rendered.rerender(() => useSSETopic(topic, { onEvent: vi.fn() }));
        expect(FakeEventSource.instances).toHaveLength(2);
        expect(FakeEventSource.instances[1].url).toBe("http://api.test/events?topics=data");
    });
});
