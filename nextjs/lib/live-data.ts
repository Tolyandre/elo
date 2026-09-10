/**
 * Trailing-debounce batcher for the global data-change signals (the "data"
 * topic of the multiplexed /events SSE stream). The server broadcasts one
 * payload-less signal per mutation — adding a match emits "matches-changed" +
 * "players-changed" — and bursts happen (offline sync pushes a whole queue of
 * matches at once), so signals are accumulated and flushed as one batch after
 * a quiet window.
 */
export type DataChangeBatch = {
    matches: boolean;
    players: boolean;
};

export type DataEventBatcher = {
    /** Records one "matches-changed" / "players-changed" signal. */
    add: (eventType: string) => void;
    /** Drops any pending batch (e.g. on teardown). */
    cancel: () => void;
};

export function createDataEventBatcher(
    onBatch: (batch: DataChangeBatch) => void,
    delayMs = 500,
): DataEventBatcher {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: DataChangeBatch = { matches: false, players: false };

    return {
        add(eventType: string) {
            if (eventType === "matches-changed") {
                pending.matches = true;
            } else if (eventType === "players-changed") {
                pending.players = true;
            } else {
                return;
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                const batch = pending;
                pending = { matches: false, players: false };
                if (batch.matches || batch.players) {
                    onBatch(batch);
                }
            }, delayMs);
        },
        cancel() {
            if (timer) clearTimeout(timer);
            timer = null;
            pending = { matches: false, players: false };
        },
    };
}
