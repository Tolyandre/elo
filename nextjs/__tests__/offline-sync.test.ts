import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { SyncApi, SyncCallResult, syncOffline } from '../lib/offline/sync';
import { OfflineStore, PendingMatch, PendingPlayer } from '../lib/offline/types';

const noopPersist = () => { };

type RawMatch = Omit<PendingMatch, 'tournamentIds'> & { tournamentIds?: string[] };

function makeStore(partial: { games?: OfflineStore['games']; players?: OfflineStore['players']; matches?: RawMatch[] }): OfflineStore {
    return {
        games: partial.games ?? [],
        players: partial.players ?? [],
        // tournamentIds/clubIds default to [] so test fixtures can omit them.
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
        addClubMember: vi.fn(async ({ club_id, player_id }) => {
            calls.push(`club:${club_id}:${player_id}`);
            return { ok: true, data: null } as SyncCallResult<null>;
        }),
        addMatch: vi.fn(async (body) => {
            calls.push(`match:${body.game_id}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: string }>;
        }),
    };
}

const pendingGame = (clientId: string, name: string, createdAt = '2026-06-01T10:00:00Z') =>
    ({ clientId, name, createdAt, status: 'pending' as const });
const pendingPlayer = (clientId: string, name: string, createdAt = '2026-06-01T10:00:00Z', clubIds: string[] = []): PendingPlayer =>
    ({ clientId, name, createdAt, status: 'pending', clubIds });

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
            calculator_kind: null,
            calculator_data: null,
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

    describe('club memberships', () => {
        it('adds the player to each chosen club after creating them, in order', async () => {
            const api = okApi();
            const playerId = uuidv7();
            const clubA = uuidv7();
            const clubB = uuidv7();
            const store = makeStore({
                players: [pendingPlayer(playerId, 'Вася', '2026-06-01T10:00:00Z', [clubA, clubB])],
            });

            const outcome = await syncOffline(store, api, noopPersist);

            expect(outcome.store.players).toHaveLength(0);
            expect(api.createPlayer).toHaveBeenCalledWith({ id: playerId, name: 'Вася' });
            expect(api.addClubMember).toHaveBeenCalledTimes(2);
            // Memberships are applied in the declared order, using the player's
            // final id (their clientId), after the create succeeds.
            expect(api.addClubMember).toHaveBeenNthCalledWith(1, { club_id: clubA, player_id: playerId });
            expect(api.addClubMember).toHaveBeenNthCalledWith(2, { club_id: clubB, player_id: playerId });
        });

        it('keeps the player pending and visible when one membership is HTTP-rejected', async () => {
            const api = okApi();
            const playerId = uuidv7();
            const clubA = uuidv7();
            const clubB = uuidv7();
            api.addClubMember = vi.fn(async ({ club_id }) =>
                club_id === clubA
                    ? { ok: false as const, status: 403, message: 'forbidden' }
                    : { ok: true as const, data: null });

            const store = makeStore({
                players: [pendingPlayer(playerId, 'Вася', '2026-06-01T10:00:00Z', [clubA, clubB])],
            });

            const outcome = await syncOffline(store, api, noopPersist);

            // Player create + the second membership succeeded, but the player is
            // NOT removed from the store because a membership errored — so the
            // error is surfaced and the user can retry / fix it.
            expect(api.createPlayer).toHaveBeenCalledTimes(1);
            expect(api.addClubMember).toHaveBeenCalledTimes(2);
            expect(outcome.store.players).toHaveLength(1);
            expect(outcome.store.players[0]).toMatchObject({ status: 'error', error: 'forbidden' });
        });

        it('aborts on a membership network failure, leaving the player pending for retry', async () => {
            const api = okApi();
            const playerId = uuidv7();
            const clubA = uuidv7();
            api.addClubMember = vi.fn(async () => { throw new TypeError('fetch failed'); });

            const store = makeStore({
                players: [pendingPlayer(playerId, 'Вася', '2026-06-01T10:00:00Z', [clubA])],
            });

            const outcome = await syncOffline(store, api, noopPersist);

            expect(outcome.aborted).toBe(true);
            // Player stayed pending — re-sync will recreate (idempotent) and
            // re-add the membership (ON CONFLICT DO NOTHING).
            expect(outcome.store.players).toHaveLength(1);
            expect(outcome.store.players[0].status).toBe('pending');
        });

        it('stops and reports authRequired on a 401 during membership add', async () => {
            const api = okApi();
            const playerId = uuidv7();
            const clubA = uuidv7();
            api.addClubMember = vi.fn(async () => ({ ok: false as const, status: 401, message: 'unauthorized' }));

            const store = makeStore({
                players: [pendingPlayer(playerId, 'Вася', '2026-06-01T10:00:00Z', [clubA])],
            });

            const outcome = await syncOffline(store, api, noopPersist);

            expect(outcome.authRequired).toBe(true);
            expect(outcome.store.players[0].status).toBe('pending');
        });
    });

    describe('calculator_data', () => {
        it('forwards calculator_kind and calculator_data on a synced match', async () => {
            const api = okApi();
            const matchId = uuidv7();
            const calcData = { rounds: [{ scores: [10, 5] }] };
            const store = makeStore({
                matches: [{
                    clientId: matchId,
                    createdAt: '2026-06-01T11:00:00Z',
                    status: 'pending',
                    gameId: SERVER_GAME_ID,
                    score: { '1': 10, '2': 5 },
                    calculatorKind: 'skull-king',
                    calculatorData: calcData,
                }],
            });

            await syncOffline(store, api, noopPersist);

            expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({
                calculator_kind: 'skull-king',
                calculator_data: calcData,
            }));
        });

        it('sends null calculator fields when the match has none', async () => {
            const api = okApi();
            const matchId = uuidv7();
            const store = makeStore({
                matches: [{
                    clientId: matchId,
                    createdAt: '2026-06-01T11:00:00Z',
                    status: 'pending',
                    gameId: SERVER_GAME_ID,
                    score: { '1': 1, '2': 2 },
                }],
            });

            await syncOffline(store, api, noopPersist);

            expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({
                calculator_kind: null,
                calculator_data: null,
            }));
        });
    });
});
