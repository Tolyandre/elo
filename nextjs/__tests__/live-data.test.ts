import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDataEventBatcher, emitDataChange, subscribeDataChange } from '../lib/live-data';

describe('createDataEventBatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes a single signal after the quiet window', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('matches-changed');
        expect(batches).toEqual([]);

        vi.advanceTimersByTime(500);
        expect(batches).toEqual([{ matches: true, players: false, arenas: false }]);
    });

    it('collapses a burst into one combined batch (offline-sync queue)', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        // Offline sync pushes several matches; the server emits both signals
        // per match. All of it must become a single invalidation.
        for (let i = 0; i < 5; i++) {
            batcher.add('matches-changed');
            batcher.add('players-changed');
            vi.advanceTimersByTime(100);
        }

        vi.advanceTimersByTime(500);
        expect(batches).toEqual([{ matches: true, players: true, arenas: false }]);
    });

    it('carries the arenas signal (a queued arena recalculation)', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('arenas-changed');
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([{ matches: false, players: false, arenas: true }]);
    });

    it('keeps batches separated once flushed', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('players-changed');
        vi.advanceTimersByTime(500);
        batcher.add('matches-changed');
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([
            { matches: false, players: true, arenas: false },
            { matches: true, players: false, arenas: false },
        ]);
    });

    it('ignores unrelated event types', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('markets-changed');
        batcher.add('heartbeat');
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([]);
    });

    it('cancel drops the pending batch', () => {
        const batches: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const batcher = createDataEventBatcher((b) => batches.push(b));

        batcher.add('matches-changed');
        batcher.cancel();
        vi.advanceTimersByTime(500);

        expect(batches).toEqual([]);
    });
});

describe('data-change emitter', () => {
    it('delivers batches to every subscriber until they unsubscribe', () => {
        const seenA: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const seenB: Array<{ matches: boolean; players: boolean; arenas: boolean }> = [];
        const unsubA = subscribeDataChange((b) => seenA.push(b));
        const unsubB = subscribeDataChange((b) => seenB.push(b));

        emitDataChange({ matches: true, players: false, arenas: false });
        unsubA();
        unsubB();
        emitDataChange({ matches: false, players: true, arenas: false });

        expect(seenA).toEqual([{ matches: true, players: false, arenas: false }]);
        expect(seenB).toEqual([{ matches: true, players: false, arenas: false }]);
    });

    it('emitting with no subscribers is a no-op', () => {
        expect(() => emitDataChange({ matches: true, players: true, arenas: false })).not.toThrow();
    });
});
