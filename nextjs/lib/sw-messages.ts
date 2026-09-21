/**
 * Messages the service worker (app/sw.ts) posts to open tabs via
 * `client.postMessage`. Pages receive them on `navigator.serviceWorker`
 * "message" events and must validate the payload with `parseSwMessage` —
 * `event.data` is untyped cross-context input.
 *
 * Note: during precache install the posting worker is the *installing* worker
 * (not yet the controller), which is why these still reach every open tab.
 */
export type SwToPageMessage =
    /** Emitted once per precache entry processed while a new worker installs. */
    | { type: "sw-precache-progress"; done: number; total: number }
    /**
     * A cached API read was served to the page (network timed out after
     * networkTimeoutSeconds or failed) — the data the page just rendered may
     * be stale. Never sent when no cached copy exists.
     */
    | { type: "api-served-from-cache"; url: string }
    /** A real network API read succeeded — clears the stale flag. */
    | { type: "api-network-ok"; url: string };

/** Validate an untyped message payload as a {@link SwToPageMessage}. */
export function parseSwMessage(data: unknown): SwToPageMessage | null {
    if (typeof data !== "object" || data === null) return null;
    const type = (data as { type?: unknown }).type;
    if (type === "sw-precache-progress") {
        const { done, total } = data as { done?: unknown; total?: unknown };
        if (typeof done === "number" && typeof total === "number") {
            return { type: "sw-precache-progress", done, total };
        }
        return null;
    }
    if (type === "api-served-from-cache" || type === "api-network-ok") {
        const { url } = data as { url?: unknown };
        if (typeof url === "string") return { type, url };
        return null;
    }
    return null;
}
