import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { SyncApi, SyncCallResult, syncOffline } from '../lib/offline/sync';
import { OfflineStore, PendingMatch } from '../lib/offline/types';

const noopPersist = () => { };

type RawMatch = Omit<PendingMatch, 'tournamentIds'> & { tournamentIds?: string[] };

function makeStore(partial: { games?: OfflineStore['games']; players?: OfflineStore['players']; matches?: RawMatch[] }): OfflineStore {
    return {
        games: partial.games ?? [],
        players: partial.players ?? [],
        // tournamentIds defaults to [] so test fixtures can omit it.
        matches: (partial.matches ?? []).map((m) => ({ ...m, tournamentIds: m.tournamentIds ?? [] })),
    };
}

function okApi(): SyncApi & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        createGame: vi.fn(async (body) => {
            calls.push(`game:${body.name}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: string }>;
        }),
        createPlayer: vi.fn(async (body) => {
            calls.push(`player:${body.name}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: string }>;
        }),
        addMatch: vi.fn(async (body) => {
            calls.push(`match:${body.game_id}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: string }>;
        }),
    };
}

const pendingGame = (clientId: string, name: string, createdAt = '2026-06-01T10:00:00Z') =>
    ({ clientId, name, createdAt, status: 'pending' as const });
const pendingPlayer = pendingGame;

// A stable server-side game/player that a pending match can reference.
const SERVER_GAME_ID = '018f6b00-0000-7000-8000-000000000005';
const SERVER_PLAYER_ID = '018f6b00-0000-7000-8000-000000000001';

describe('syncOffline', () => {
    it('syncs games, then players, then matches using their final ids', async () => {
        const api = okApi();
        const gameId = uuidv7();
        const playerId = uuidv7();
        const matchId = uuidv7();
        const store = makeStore({
            games: [pendingGame(gameId, 'Каркассон')],
            players: [pendingPlayer(playerId, 'Вася')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId,
                score: { [playerId]: 10, [SERVER_PLAYER_ID]: 5 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => new Date('2026-06-12T00:00:00Z'));

        expect(outcome.aborted).toBe(false);
        expect(outcome.authRequired).toBe(false);
        expect(outcome.syncedCount).toBe(3);
        expect(outcome.store.games).toHaveLength(0);
        expect(outcome.store.players).toHaveLength(0);
        expect(outcome.store.matches).toHaveLength(0);
        expect(api.calls).toEqual(['game:Каркассон', 'player:Вася', `match:${gameId}`]);
        expect(api.createGame).toHaveBeenCalledWith({ id: gameId, name: 'Каркассон' });
        expect(api.createPlayer).toHaveBeenCalledWith({ id: playerId, name: 'Вася' });
        expect(api.addMatch).toHaveBeenCalledWith({
            id: matchId,
            game_id: gameId,
            score: { [playerId]: 10, [SERVER_PLAYER_ID]: 5 },
            date: '2026-06-01T11:00:00Z',
            tournament_ids: [],
        });
    });

    it('forwards tournament_ids on a synced match', async () => {
        const api = okApi();
        const matchId = uuidv7();
        const store = makeStore({
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { '1': 1, '2': 2 },
                tournamentIds: ['7', '9'],
            }],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({ tournament_ids: ['7', '9'] }));
    });

    it('syncs in createdAt order', async () => {
        const api = okApi();
        const store = makeStore({
            games: [
                pendingGame(uuidv7(), 'Вторая', '2026-06-02T10:00:00Z'),
                pendingGame(uuidv7(), 'Первая', '2026-06-01T10:00:00Z'),
            ],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.calls).toEqual(['game:Первая', 'game:Вторая']);
    });

    it('keeps an HTTP-rejected item as error and continues with the rest', async () => {
        const api = okApi();
        const dupId = uuidv7();
        api.createGame = vi.fn(async (body) =>
            body.name === 'Дубль'
                ? { ok: false as const, status: 409, message: 'game with this name already exists' }
                : { ok: true as const, data: { id: body.id } });
        const store = makeStore({
            games: [
                pendingGame(dupId, 'Дубль', '2026-06-01T10:00:00Z'),
                pendingGame(uuidv7(), 'Нормальная', '2026-06-02T10:00:00Z'),
            ],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.aborted).toBe(false);
        expect(outcome.store.games).toHaveLength(1);
        expect(outcome.store.games[0]).toMatchObject({
            clientId: dupId,
            status: 'error',
            error: 'game with this name already exists',
        });
        expect(outcome.syncedCount).toBe(1);
    });

    it('aborts on network failure leaving items pending', async () => {
        const api = okApi();
        api.createPlayer = vi.fn(async () => { throw new TypeError('fetch failed'); });
        const store = makeStore({
            games: [pendingGame(uuidv7(), 'Игра')],
            players: [pendingPlayer(uuidv7(), 'Игрок')],
            matches: [{
                clientId: uuidv7(),
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
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
            games: [pendingGame(uuidv7(), 'Игра')],
            matches: [{
                clientId: uuidv7(),
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
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
                clientId: uuidv7(),
                createdAt: '2026-06-12T13:00:00Z', // device clock ran ahead
                status: 'pending',
                gameId: SERVER_GAME_ID,
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
            games: [pendingGame(uuidv7(), 'А'), pendingGame(uuidv7(), 'Б', '2026-06-02T10:00:00Z')],
        });

        await syncOffline(store, api, (s) => snapshots.push(s.games.length));

        // markSyncing + removal per item → final snapshot has an empty store
        expect(snapshots[snapshots.length - 1]).toBe(0);
        expect(snapshots.length).toBeGreaterThanOrEqual(4);
    });
});
