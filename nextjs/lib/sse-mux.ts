import { EloWebServiceBaseUrl } from "@/app/api";
import { createSSEConnection, parseSSEEnvelope, type SSEConnection, type SSEEnvelope } from "@/lib/sse-connection";

/**
 * One shared SSE connection for every app-global topic: the "data"
 * change signals, the "lobby:tables" and "lobby:markets" lobby signals and
 * the per-user "me" events ride a single `GET /events?topics=...` stream
 * (multiplexed by the backend, each frame tagged with its topic as the SSE
 * event name). This replaces one HTTP connection per subscriber — a signed-in
 * visitor holds one stream instead of three regardless of how many
 * components care about which topics.
 *
 * The store is a module-level singleton: it opens the connection when the
 * first topic gets a subscriber and closes it when the last one leaves.
 * Adding or removing a topic changes the connection's `topics` query param,
 * which reopens the stream — the resulting gap fans onRecover out to every
 * subscriber, so a topic-set change (e.g. login toggling "me") refetches
 * everything.
 */

export type TopicSubscriber = {
    /** Dispatches one parsed event envelope from this topic. */
    onEvent: (event: SSEEnvelope) => void;
    /** The stream may have missed events — refetch to catch up. */
    onRecover?: () => void;
    /** Whether the shared connection is currently open. */
    onConnectedChange?: (connected: boolean) => void;
};

const subscribers = new Map<string, Set<TopicSubscriber>>();
let connection: SSEConnection | null = null;
let connectionUrl: string | null = null;

function muxUrl(topics: string[]): string {
    return `${EloWebServiceBaseUrl}/events?topics=${topics.join(",")}`;
}

function fanRecover(): void {
    for (const set of subscribers.values()) {
        for (const subscriber of set) subscriber.onRecover?.();
    }
}

/**
 * Opens the shared connection for the current topic set, reopens it when the
 * set changed, or closes it when no topic has subscribers left.
 */
function ensureConnection(): void {
    const topics = [...subscribers.keys()].sort();
    const url = topics.length > 0 ? muxUrl(topics) : null;
    if (connection && connectionUrl === url) return;

    // A topic-set change switches the stream URL: subscribers that stay on
    // missed whatever the closing connection would have delivered, so fan a
    // recover out once the new one exists.
    const switching = connection !== null || connectionUrl !== null;
    connection?.close();
    connection = null;
    connectionUrl = null;

    if (!url) return;
    connection = createSSEConnection(url, {
        namedEvents: topics,
        onNamedEvent: (topic, payload) => {
            const parsed = parseSSEEnvelope(payload);
            if (!parsed) return;
            for (const subscriber of subscribers.get(topic) ?? []) {
                subscriber.onEvent(parsed);
            }
        },
        onRecover: fanRecover,
        onConnectedChange: (connected) => {
            for (const set of subscribers.values()) {
                for (const subscriber of set) subscriber.onConnectedChange?.(connected);
            }
        },
    });
    connectionUrl = url;
    if (switching) fanRecover();
}

/**
 * Subscribes to one topic of the shared connection. Returns the unsubscribe
 * function; the connection closes once no topic has subscribers left.
 */
export function subscribeTopic(topic: string, subscriber: TopicSubscriber): () => void {
    let set = subscribers.get(topic);
    if (!set) {
        set = new Set();
        subscribers.set(topic, set);
    }
    set.add(subscriber);
    ensureConnection();

    return () => {
        const s = subscribers.get(topic);
        if (!s) return;
        s.delete(subscriber);
        if (s.size === 0) subscribers.delete(topic);
        ensureConnection();
    };
}
