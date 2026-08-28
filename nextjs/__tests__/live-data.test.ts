import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDataEventBatcher } from '../lib/live-data';

describe('createDataEventBatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes a single signal after the quiet window', () => {
        const batches: Array<{ matches: boolean; players: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('matches-changed');
        expect(batches).toEqual([]);

        vi.advanceTimersByTime(500);
        expect(batches).toEqual([{ matches: true, players: false }]);
    });

    it('collapses a burst into one combined batch (offline-sync queue)', () => {
        const batches: Array<{ matches: boolean; players: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        // Offline sync pushes several matches; the server emits both signals
        // per match. All of it must become a single invalidation.
        for (let i = 0; i < 5; i++) {
            batcher.add('matches-changed');
            batcher.add('players-changed');
            vi.advanceTimersByTime(100);
        }

        vi.advanceTimersByTime(500);
        expect(batches).toEqual([{ matches: true, players: true }]);
    });

    it('keeps batches separated once flushed', () => {
        const batches: Array<{ matches: boolean; players: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('players-changed');
        vi.advanceTimersByTime(500);
        batcher.add('matches-changed');
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([
            { matches: false, players: true },
            { matches: true, players: false },
        ]);
    });

    it('ignores unrelated event types', () => {
        const batches: Array<{ matches: boolean; players: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('markets-changed');
        batcher.add('heartbeat');
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([]);
    });

    it('cancel drops the pending batch', () => {
        const batches: Array<{ matches: boolean; players: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('matches-changed');
        batcher.cancel();
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([]);
    });
});
