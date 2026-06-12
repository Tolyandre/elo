import { describe, expect, it, vi } from 'vitest';
import { SyncApi, SyncCallResult, syncOffline } from '../lib/offline/sync';
import { OfflineStore, idempotencyKeyOf } from '../lib/offline/types';

const noopPersist = () => { };

function makeStore(partial: Partial<OfflineStore>): OfflineStore {
    return { games: [], players: [], matches: [], ...partial };
}

function okApi(): SyncApi & { calls: string[] } {
    let nextGameId = 100;
    let nextPlayerId = 200;
    let nextMatchId = 300;
    const calls: string[] = [];
    return {
        calls,
        createGame: vi.fn(async (body) => {
            calls.push(`game:${body.name}`);
            return { ok: true, data: { id: String(nextGameId++) } } as SyncCallResult<{ id: string }>;
        }),
        createPlayer: vi.fn(async (body) => {
            calls.push(`player:${body.name}`);
            return { ok: true, data: { id: String(nextPlayerId++) } } as SyncCallResult<{ id: string }>;
        }),
        addMatch: vi.fn(async (body) => {
            calls.push(`match:${body.game_id}`);
            return { ok: true, data: { id: nextMatchId++ } } as SyncCallResult<{ id: number }>;
        }),
    };
}

const pendingGame = (clientId: string, name: string, createdAt = '2026-06-01T10:00:00Z') =>
    ({ clientId, name, createdAt, status: 'pending' as const });
const pendingPlayer = pendingGame;

describe('syncOffline', () => {
    it('syncs games, then players, then matches with rewritten ids', async () => {
        const api = okApi();
        const store = makeStore({
            games: [pendingGame('offline:g1', 'Каркассон')],
            players: [pendingPlayer('offline:p1', 'Вася')],
            matches: [{
                clientId: 'offline:m1',
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: 'offline:g1',
                score: { 'offline:p1': 10, '42': 5 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => new Date('2026-06-12T00:00:00Z'));

        expect(outcome.aborted).toBe(false);
        expect(outcome.authRequired).toBe(false);
        expect(outcome.syncedCount).toBe(3);
        expect(outcome.store.games).toHaveLength(0);
        expect(outcome.store.players).toHaveLength(0);
        expect(outcome.store.matches).toHaveLength(0);
        expect(api.calls).toEqual(['game:Каркассон', 'player:Вася', 'match:100']);
        expect(api.addMatch).toHaveBeenCalledWith({
            game_id: '100',
            score: { '200': 10, '42': 5 },
            date: '2026-06-01T11:00:00Z',
            idempotency_key: idempotencyKeyOf('offline:m1'),
        });
    });

    it('syncs in createdAt order', async () => {
        const api = okApi();
        const store = makeStore({
            games: [
                pendingGame('offline:g2', 'Вторая', '2026-06-02T10:00:00Z'),
                pendingGame('offline:g1', 'Первая', '2026-06-01T10:00:00Z'),
            ],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.calls).toEqual(['game:Первая', 'game:Вторая']);
    });

    it('keeps an HTTP-rejected item as error and continues with the rest', async () => {
        const api = okApi();
        api.createGame = vi.fn(async (body) =>
            body.name === 'Дубль'
                ? { ok: false as const, status: 409, message: 'game with this name already exists' }
                : { ok: true as const, data: { id: '1' } });
        const store = makeStore({
            games: [
                pendingGame('offline:g1', 'Дубль', '2026-06-01T10:00:00Z'),
                pendingGame('offline:g2', 'Нормальная', '2026-06-02T10:00:00Z'),
            ],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.aborted).toBe(false);
        expect(outcome.store.games).toHaveLength(1);
        expect(outcome.store.games[0]).toMatchObject({
            clientId: 'offline:g1',
            status: 'error',
            error: 'game with this name already exists',
        });
        expect(outcome.syncedCount).toBe(1);
    });

    it('marks a match as error when its dependency failed to sync', async () => {
        const api = okApi();
        api.createGame = vi.fn(async () => ({ ok: false as const, status: 400, message: 'bad' }));
        const store = makeStore({
            games: [pendingGame('offline:g1', 'Сломанная')],
            matches: [{
                clientId: 'offline:m1',
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: 'offline:g1',
                score: { '1': 1, '2': 2 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(api.addMatch).not.toHaveBeenCalled();
        expect(outcome.store.matches[0]).toMatchObject({
            status: 'error',
            error: 'зависит от несинхронизированной записи',
        });
    });

    it('aborts on network failure leaving items pending', async () => {
        const api = okApi();
        api.createPlayer = vi.fn(async () => { throw new TypeError('fetch failed'); });
        const store = makeStore({
            games: [pendingGame('offline:g1', 'Игра')],
            players: [pendingPlayer('offline:p1', 'Игрок')],
            matches: [{
                clientId: 'offline:m1',
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: '5',
                score: { '1': 1, '2': 2 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.aborted).toBe(true);
        expect(outcome.syncedCount).toBe(1); // the game synced before the failure
        expect(outcome.store.players[0].status).toBe('pending');
        expect(outcome.store.matches[0].status).toBe('pending');
        expect(api.addMatch).not.toHaveBeenCalled();
    });

    it('stops and reports authRequired on 401', async () => {
        const api = okApi();
        api.createGame = vi.fn(async () => ({ ok: false as const, status: 401, message: 'unauthorized' }));
        const store = makeStore({
            games: [pendingGame('offline:g1', 'Игра')],
            matches: [{
                clientId: 'offline:m1',
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: '5',
                score: { '1': 1, '2': 2 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.authRequired).toBe(true);
        expect(api.addMatch).not.toHaveBeenCalled();
        expect(outcome.store.games[0].status).toBe('pending');
        expect(outcome.store.matches[0].status).toBe('pending');
    });

    it('clamps a future createdAt to now for the match date', async () => {
        const api = okApi();
        const now = new Date('2026-06-12T12:00:00.000Z');
        const store = makeStore({
            matches: [{
                clientId: 'offline:m1',
                createdAt: '2026-06-12T13:00:00Z', // device clock ran ahead
                status: 'pending',
                gameId: '5',
                score: { '1': 1, '2': 2 },
            }],
        });

        await syncOffline(store, api, noopPersist, () => now);

        expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({ date: now.toISOString() }));
    });

    it('persists progress after each item', async () => {
        const api = okApi();
        const snapshots: number[] = [];
        const store = makeStore({
            games: [pendingGame('offline:g1', 'А'), pendingGame('offline:g2', 'Б', '2026-06-02T10:00:00Z')],
        });

        await syncOffline(store, api, (s) => snapshots.push(s.games.length));

        // markSyncing + removal per item → final snapshot has an empty store
        expect(snapshots[snapshots.length - 1]).toBe(0);
        expect(snapshots.length).toBeGreaterThanOrEqual(4);
    });
});
