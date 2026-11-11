import { describe, expect, it, vi, type Mock } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { hasNewArrivals, ServerGameFields, ServerMatchFields, SyncApi, SyncCallResult, syncOffline } from '../lib/offline/sync';
import { OfflineStore, PendingGame, PendingMatch, PendingPlayer } from '../lib/offline/types';
import { applyResolutions } from '../lib/offline/merge';
import { Base58ID } from '../lib/id';

const noopPersist = () => { };

type RawMatch = Omit<PendingMatch, 'campArenaIds'> & { campArenaIds?: PendingMatch['campArenaIds'] };

function makeStore(partial: { games?: OfflineStore['games']; players?: OfflineStore['players']; matches?: RawMatch[] }): OfflineStore {
    return {
        games: partial.games ?? [],
        players: partial.players ?? [],
        // campArenaIds/clubIds default to [] so test fixtures can omit them.
        matches: (partial.matches ?? []).map((m) => ({ ...m, campArenaIds: m.campArenaIds ?? [] })),
    };
}

// The mock fns are exposed so tests can reprogram them mid-run; the SyncApi
// side stays the engine's contract.
type MockedApi = SyncApi & {
    calls: string[];
    createGame: Mock;
    addGameTag: Mock;
    createPlayer: Mock;
    addClubMember: Mock;
    addMatch: Mock;
};

function okApi(): MockedApi {
    const calls: string[] = [];
    return {
        calls,
        createGame: vi.fn(async (body: { name: string; id: Base58ID }) => {
            calls.push(`game:${body.name}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: Base58ID }>;
        }),
        addGameTag: vi.fn(async ({ game_id, tag_id }: { game_id: Base58ID; tag_id: Base58ID }) => {
            calls.push(`tag:${game_id}:${tag_id}`);
            return { ok: true, data: null } as SyncCallResult<null>;
        }),
        createPlayer: vi.fn(async (body: { name: string; id: Base58ID }) => {
            calls.push(`player:${body.name}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: Base58ID }>;
        }),
        addClubMember: vi.fn(async ({ club_id, player_id }: { club_id: Base58ID; player_id: Base58ID }) => {
            calls.push(`club:${club_id}:${player_id}`);
            return { ok: true, data: null } as SyncCallResult<null>;
        }),
        addMatch: vi.fn(async (body: { game_id: Base58ID; id: Base58ID }) => {
            calls.push(`match:${body.game_id}`);
            return { ok: true, data: { id: body.id } } as SyncCallResult<{ id: Base58ID }>;
        }),
    };
}

const pendingGame = (clientId: Base58ID, name: string, createdAt = '2026-06-01T10:00:00Z', tagIds: Base58ID[] = []): PendingGame =>
    ({ clientId, name, createdAt, status: 'pending' as const, tagIds });
const pendingPlayer = (clientId: Base58ID, name: string, createdAt = '2026-06-01T10:00:00Z', clubIds: Base58ID[] = []): PendingPlayer =>
    ({ clientId, name, createdAt, status: 'pending', clubIds });

const matchFixture = (clientId: Base58ID, createdAt: string): PendingMatch => ({
    clientId,
    createdAt,
    status: 'pending',
    gameId: SERVER_GAME_ID,
    score: { '1': 1, '2': 2 },
    campArenaIds: [],
});

// A stable server-side game/player that a pending match can reference.
const SERVER_GAME_ID = '018f6b00-0000-7000-8000-000000000005' as Base58ID;
const SERVER_PLAYER_ID = '018f6b00-0000-7000-8000-000000000001' as Base58ID;

describe('syncOffline', () => {
    it('syncs games, then players, then matches using their final ids', async () => {
        const api = okApi();
        const gameId = uuidv7() as Base58ID;
        const playerId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            games: [pendingGame(gameId, 'Каркассон')],
            players: [pendingPlayer(playerId, 'Вася')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                tenantId: '018f6b00-0000-7000-8000-000000000101' as Base58ID,
                gameId,
                score: { [playerId]: 10, [SERVER_PLAYER_ID]: 5 },
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

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
            tenant: '018f6b00-0000-7000-8000-000000000101' as Base58ID,
            id: matchId,
            game_id: gameId,
            score: { [playerId]: 10, [SERVER_PLAYER_ID]: 5 },
            date: '2026-06-01T11:00:00Z',
            camp_arena_ids: [],
            calculator_kind: null,
            calculator_data: null,
        });
    });

    it('forwards camp_arena_ids on a synced match', async () => {
        const api = okApi();
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { '1': 1, '2': 2 },
                campArenaIds: ['7' as Base58ID, '9' as Base58ID],
            }],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({ camp_arena_ids: ['7', '9'] }));
    });

    it('forwards the game_mode of a pending game on create (ADR-33)', async () => {
        const api = okApi();
        const gameId = uuidv7() as Base58ID;
        const store = makeStore({
            games: [{
                clientId: gameId,
                name: 'Кооператив',
                createdAt: '2026-06-01T10:00:00Z',
                status: 'pending',
                meta: { gameMode: 'coop' },
            }],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.createGame).toHaveBeenCalledWith(expect.objectContaining({ game_mode: 'coop' }));
    });

    it('pushes a coop match with the shared result and participants, no score map (ADR-33)', async () => {
        const api = okApi();
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: {},
                mode: 'coop',
                playerIds: ['1' as Base58ID, '2' as Base58ID],
                gameScore: 45,
                gameWon: true,
            }],
        });

        await syncOffline(store, api, noopPersist);

        const call = vi.mocked(api.addMatch).mock.calls[0][0];
        expect(call.mode).toBe('coop');
        expect(call.player_ids).toEqual(['1', '2']);
        expect(call.game_score).toBe(45);
        expect(call.game_won).toBe(true);
        expect(call).not.toHaveProperty('skip_tournament_link');
    });

    it('forwards skip_tournament_link only when the match asked to stay out', async () => {
        const api = okApi();
        const store = makeStore({
            matches: [
                {
                    clientId: uuidv7() as Base58ID,
                    createdAt: '2026-06-01T11:00:00Z',
                    status: 'pending',
                    gameId: SERVER_GAME_ID,
                    score: { '1': 1, '2': 2 },
                    // Unchecked checkbox queued offline: the opt-out must
                    // survive until the sync write (ADR-26).
                    skipTournamentLink: true,
                },
                {
                    clientId: uuidv7() as Base58ID,
                    createdAt: '2026-06-01T11:01:00Z',
                    status: 'pending',
                    gameId: SERVER_GAME_ID,
                    score: { '1': 3, '2': 4 },
                    // No flag: acceptance is decided server-side at the write.
                },
            ],
        });

        await syncOffline(store, api, noopPersist);

        const calls = vi.mocked(api.addMatch).mock.calls;
        expect(calls[0][0]).toEqual(expect.objectContaining({ skip_tournament_link: true }));
        expect(calls[1][0]).not.toHaveProperty('skip_tournament_link');
    });

    it('syncs in createdAt order', async () => {
        const api = okApi();
        const store = makeStore({
            games: [
                pendingGame(uuidv7() as Base58ID, 'Вторая', '2026-06-02T10:00:00Z'),
                pendingGame(uuidv7() as Base58ID, 'Первая', '2026-06-01T10:00:00Z'),
            ],
        });

        await syncOffline(store, api, noopPersist);

        expect(api.calls).toEqual(['game:Первая', 'game:Вторая']);
    });

    it('applies game tags right after the game is created', async () => {
        const api = okApi();
        const gameId = uuidv7() as Base58ID;
        const tagA = '7' as Base58ID;
        const tagB = '9' as Base58ID;
        const store = makeStore({
            games: [pendingGame(gameId, 'Каркассон', '2026-06-01T10:00:00Z', [tagA, tagB])],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.aborted).toBe(false);
        expect(outcome.syncedCount).toBe(1);
        expect(outcome.store.games).toHaveLength(0);
        expect(api.calls).toEqual([`game:Каркассон`, `tag:${gameId}:${tagA}`, `tag:${gameId}:${tagB}`]);
        expect(api.addGameTag).toHaveBeenCalledWith({ game_id: gameId, tag_id: tagA });
        expect(api.addGameTag).toHaveBeenCalledWith({ game_id: gameId, tag_id: tagB });
    });

    it('keeps the game pending when a tag is rejected, so tags are retried', async () => {
        const api = okApi();
        const gameId = uuidv7() as Base58ID;
        api.addGameTag = vi.fn(async ({ tag_id }) =>
            tag_id === ('7' as Base58ID)
                ? { ok: false as const, status: 400, message: 'game or tag not found' }
                : { ok: true as const, data: null });
        const store = makeStore({
            games: [pendingGame(gameId, 'С тегами', '2026-06-01T10:00:00Z', ['7' as Base58ID, '9' as Base58ID])],
        });

        const outcome = await syncOffline(store, api, noopPersist);

        expect(outcome.aborted).toBe(false);
        expect(outcome.syncedCount).toBe(1); // the game itself synced
        expect(outcome.store.games).toHaveLength(1);
        expect(outcome.store.games[0]).toMatchObject({ clientId: gameId, status: 'error' });
        // Both tags were attempted even after the first one failed.
        expect(api.addGameTag).toHaveBeenCalledTimes(2);
    });

    it('keeps an HTTP-rejected item as error and continues with the rest', async () => {
        const api = okApi();
        const dupId = uuidv7() as Base58ID;
        api.createGame = vi.fn(async (body) =>
            body.name === 'Дубль'
                ? { ok: false as const, status: 409, message: 'game with this name already exists' }
                : { ok: true as const, data: { id: body.id } });
        const store = makeStore({
            games: [
                pendingGame(dupId, 'Дубль', '2026-06-01T10:00:00Z'),
                pendingGame(uuidv7() as Base58ID, 'Нормальная', '2026-06-02T10:00:00Z'),
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
            games: [pendingGame(uuidv7() as Base58ID, 'Игра')],
            players: [pendingPlayer(uuidv7() as Base58ID, 'Игрок')],
            matches: [{
                clientId: uuidv7() as Base58ID,
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
            games: [pendingGame(uuidv7() as Base58ID, 'Игра')],
            matches: [{
                clientId: uuidv7() as Base58ID,
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
                clientId: uuidv7() as Base58ID,
                createdAt: '2026-06-12T13:00:00Z', // device clock ran ahead
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { '1': 1, '2': 2 },
            }],
        });

        await syncOffline(store, api, noopPersist, () => store, () => now);

        expect(api.addMatch).toHaveBeenCalledWith(expect.objectContaining({ date: now.toISOString() }));
    });

    it('persists progress after each item', async () => {
        const api = okApi();
        const snapshots: number[] = [];
        const store = makeStore({
            games: [pendingGame(uuidv7() as Base58ID, 'А'), pendingGame(uuidv7() as Base58ID, 'Б', '2026-06-02T10:00:00Z')],
        });

        await syncOffline(store, api, (s) => snapshots.push(s.games.length));

        // markSyncing + removal per item → final snapshot has an empty store
        expect(snapshots[snapshots.length - 1]).toBe(0);
        expect(snapshots.length).toBeGreaterThanOrEqual(4);
    });

    describe('club memberships', () => {
        it('adds the player to each chosen club after creating them, in order', async () => {
            const api = okApi();
            const playerId = uuidv7() as Base58ID;
            const clubA = uuidv7() as Base58ID;
            const clubB = uuidv7() as Base58ID;
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
            const playerId = uuidv7() as Base58ID;
            const clubA = uuidv7() as Base58ID;
            const clubB = uuidv7() as Base58ID;
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
            const playerId = uuidv7() as Base58ID;
            const clubA = uuidv7() as Base58ID;
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
            const playerId = uuidv7() as Base58ID;
            const clubA = uuidv7() as Base58ID;
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
            const matchId = uuidv7() as Base58ID;
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
            const matchId = uuidv7() as Base58ID;
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

describe('mid-run queue changes', () => {
    // A stand-in for the persisted store: the provider keeps it current on
    // every mutation, the engine re-reads it via `load`.
    function liveQueue(initial: OfflineStore) {
        const live: OfflineStore = {
            games: [...initial.games],
            players: [...initial.players],
            matches: [...initial.matches],
        };
        return {
            load: () => live,
            queueMatch: (m: PendingMatch) => {
                live.matches = [...live.matches, m];
            },
            removeMatch: (clientId: Base58ID) => {
                live.matches = live.matches.filter((m) => m.clientId !== clientId);
            },
        };
    }

    it('keeps a match queued while the run is in flight (the lost-newest-match bug)', async () => {
        const api = okApi();
        const m1 = matchFixture('018f6b00-0000-7000-8000-0000000000a1' as Base58ID, '2026-06-01T11:00:00Z');
        const m2 = matchFixture('018f6b00-0000-7000-8000-0000000000a2' as Base58ID, '2026-06-01T11:05:00Z');
        const initial = makeStore({ matches: [m1] });
        const live = liveQueue(initial);
        // The user records m2 while m1's POST is in flight: the provider writes
        // it to the live store, but this run's snapshot predates it.
        let queuedAtPersist = -1;
        const persisted: OfflineStore[] = [];
        api.addMatch = vi.fn(async (body) => {
            queuedAtPersist = persisted.length;
            live.queueMatch(m2);
            return { ok: true as const, data: { id: body.id } };
        });

        const outcome = await syncOffline(initial, api, (s) => persisted.push(s), live.load);

        // The run pushes only its own snapshot; m2 waits for the drain sync.
        expect(api.addMatch).toHaveBeenCalledTimes(1);
        // Every persist from the moment m2 was queued keeps it — including the
        // removal of m1 and the final finish() write that used to wipe it.
        expect(queuedAtPersist).toBeGreaterThanOrEqual(0);
        expect(persisted.slice(queuedAtPersist).every((s) => s.matches.some((m) => m.clientId === m2.clientId))).toBe(true);
        expect(outcome.store.matches.map((m) => m.clientId)).toEqual([m2.clientId]);
    });

    it('drops a match the user deleted while the run was in flight', async () => {
        const api = okApi();
        const m1 = matchFixture('018f6b00-0000-7000-8000-0000000000b1' as Base58ID, '2026-06-01T11:00:00Z');
        const m2 = matchFixture('018f6b00-0000-7000-8000-0000000000b2' as Base58ID, '2026-06-01T11:05:00Z');
        const initial = makeStore({ matches: [m1, m2] });
        const live = liveQueue(initial);
        api.addMatch = vi.fn(async (body) => {
            if (body.id === m1.clientId) live.removeMatch(m2.clientId);
            return { ok: true as const, data: { id: body.id } };
        });

        const outcome = await syncOffline(initial, api, noopPersist, live.load);

        // m1 synced; m2 was deleted from under the run — it is neither sent
        // nor resurrected by the run's writes.
        expect(api.addMatch).toHaveBeenCalledTimes(1);
        expect(outcome.store.matches).toHaveLength(0);
    });

    it('cannot resurrect a synced item from a stale live read', async () => {
        const api = okApi();
        const m1 = matchFixture('018f6b00-0000-7000-8000-0000000000c1' as Base58ID, '2026-06-01T11:00:00Z');
        const m2 = matchFixture('018f6b00-0000-7000-8000-0000000000c2' as Base58ID, '2026-06-01T11:05:00Z');
        const store = makeStore({ matches: [m1, m2] });

        // `load` keeps returning the pristine snapshot, as if none of the
        // engine's writes ever landed — the synced items must stay removed.
        const outcome = await syncOffline(store, api, noopPersist, () => store);

        expect(api.addMatch).toHaveBeenCalledTimes(2);
        expect(outcome.store.matches).toHaveLength(0);
    });
});

describe('hasNewArrivals', () => {
    it('detects items the run never saw', () => {
        const game = pendingGame(uuidv7() as Base58ID, 'Г');
        const seen = matchFixture(uuidv7() as Base58ID, '2026-06-01T11:00:00Z');
        const fresh = matchFixture(uuidv7() as Base58ID, '2026-06-01T12:00:00Z');
        const seenIds = new Set([game.clientId, seen.clientId]);

        expect(hasNewArrivals(makeStore({ games: [game], matches: [seen] }), seenIds)).toBe(false);
        expect(hasNewArrivals(makeStore({ games: [game], matches: [seen, fresh] }), seenIds)).toBe(true);
    });
});

describe('duplicate-name adoption (ADR-37)', () => {
    // The canonical entity another device already created under the same name.
    const CANONICAL_PLAYER = '018f6b00-0000-7000-8000-0000000000aa' as Base58ID;
    const CANONICAL_GAME = '018f6b00-0000-7000-8000-0000000000bb' as Base58ID;

    function adoptApi(kind: 'player' | 'game', existingId: Base58ID): MockedApi {
        const base = okApi();
        const reject = kind === 'player' ? base.createPlayer : base.createGame;
        reject.mockImplementation(async () => ({
            ok: false,
            status: 409,
            message: 'duplicate name',
            existingId,
        }) as SyncCallResult<{ id: Base58ID }>);
        return base;
    }

    it('adopts a canonical player: rewrites score keys, applies memberships to the holder, drops the item', async () => {
        const api = adoptApi('player', CANONICAL_PLAYER);
        const loserId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const clubId = uuidv7() as Base58ID;
        const store = makeStore({
            players: [pendingPlayer(loserId, 'Вася', '2026-06-01T10:00:00Z', [clubId])],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { [loserId]: 10, [SERVER_PLAYER_ID]: 5 },
                campArenaIds: [],
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

        // The membership goes to the canonical id, not the loser's.
        expect(api.addClubMember).toHaveBeenCalledWith({ club_id: clubId, player_id: CANONICAL_PLAYER });
        // The match went out referencing the canonical player, and the queued
        // player is gone.
        expect(api.addMatch).toHaveBeenCalledTimes(1);
        expect(api.addMatch.mock.calls[0][0].score).toEqual({ [CANONICAL_PLAYER]: 10, [SERVER_PLAYER_ID]: 5 });
        expect(outcome.store.players).toHaveLength(0);
        expect(outcome.store.matches).toHaveLength(0);
        expect(outcome.syncedCount).toBe(2); // adopted create + match
    });

    it('adopts a canonical game: rewrites pending match game references', async () => {
        const api = adoptApi('game', CANONICAL_GAME);
        const loserId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            games: [pendingGame(loserId, 'Каркассон')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: loserId,
                score: { [SERVER_PLAYER_ID]: 10, 'other': 5 },
                campArenaIds: [],
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

        expect(api.addMatch).toHaveBeenCalledTimes(1);
        expect(api.addMatch.mock.calls[0][0].game_id).toBe(CANONICAL_GAME);
        expect(outcome.store.games).toHaveLength(0);
        expect(outcome.store.matches).toHaveLength(0);
    });

    it('rewrites the adopted id inside calculator_data (blind deep-walk)', async () => {
        const api = adoptApi('player', CANONICAL_PLAYER);
        const loserId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            players: [pendingPlayer(loserId, 'Вася')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { [loserId]: 10, [SERVER_PLAYER_ID]: 5 },
                campArenaIds: [],
                calculatorKind: 'skull_king',
                // Real storage shape (ADR-09): player references are VALUES
                // under player_id; rounds are positional — never keyed by id.
                calculatorData: {
                    schema_version: 1,
                    players: [
                        { player_id: loserId, name: 'Вася' },
                        { player_id: SERVER_PLAYER_ID, name: 'Петя' },
                    ],
                    current_round: 1,
                    current_player_index: 0,
                    rounds: [[{ bid: 1, bonus: 0 }, null]],
                },
            }],
        });

        await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

        const sent = api.addMatch.mock.calls[0][0];
        expect(sent.calculator_data).toEqual({
            schema_version: 1,
            players: [
                { player_id: CANONICAL_PLAYER, name: 'Вася' },
                { player_id: SERVER_PLAYER_ID, name: 'Петя' },
            ],
            current_round: 1,
            current_player_index: 0,
            rounds: [[{ bid: 1, bonus: 0 }, null]],
        });
        // The losing id is gone everywhere.
        expect(JSON.stringify(sent.calculator_data)).not.toContain(loserId);
    });

    it('keeps the item queued with an error when a membership against the canonical id is rejected', async () => {
        const api = adoptApi('player', CANONICAL_PLAYER);
        api.addClubMember.mockImplementation(async () => ({
            ok: false,
            status: 404,
            message: 'club not found',
        }) as SyncCallResult<null>);
        const loserId = uuidv7() as Base58ID;
        const clubId = uuidv7() as Base58ID;
        const store = makeStore({
            players: [pendingPlayer(loserId, 'Вася', '2026-06-01T10:00:00Z', [clubId])],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

        // Visible and retryable: the next run re-adopts (a no-op) and retries
        // the membership — the reference rewrite already happened.
        expect(outcome.store.players).toHaveLength(1);
        expect(outcome.store.players[0].status).toBe('error');
        expect(outcome.store.players[0].error).toBe('club not found');
    });
});

describe('unresolved-reference deferral (ADR-37)', () => {
    it('defers a match whose player is still queued with an error instead of sending it', async () => {
        const api = okApi();
        api.createPlayer.mockImplementation(async () => ({
            ok: false,
            status: 400,
            message: 'name is required',
        }) as SyncCallResult<{ id: Base58ID }>);
        const loserId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const store = makeStore({
            players: [pendingPlayer(loserId, 'Вася')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { [loserId]: 10 },
                campArenaIds: [],
            }],
        });

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date('2026-06-12T00:00:00Z'));

        expect(api.addMatch).not.toHaveBeenCalled();
        // The match stays pending with NO error badge — it is deferred, not
        // rejected; the next run retries it after the player is repaired.
        expect(outcome.store.matches).toHaveLength(1);
        expect(outcome.store.matches[0].status).toBe('pending');
        expect(outcome.store.matches[0].error).toBeUndefined();
    });

    it('syncs the deferred match once the dependency is repaired (next run)', async () => {
        const api = okApi();
        const loserId = uuidv7() as Base58ID;
        const matchId = uuidv7() as Base58ID;
        const firstRunStore = makeStore({
            players: [pendingPlayer(loserId, 'Вася')],
            matches: [{
                clientId: matchId,
                createdAt: '2026-06-01T11:00:00Z',
                status: 'pending',
                gameId: SERVER_GAME_ID,
                score: { [loserId]: 10 },
                campArenaIds: [],
            }],
        });

        // Run 1: the player errors (no adoption) and the match defers.
        api.createPlayer.mockImplementationOnce(async () => ({
            ok: false,
            status: 400,
            message: 'name is required',
        }) as SyncCallResult<{ id: Base58ID }>);
        const first = await syncOffline(firstRunStore, api, noopPersist, () => firstRunStore, () => new Date('2026-06-12T00:00:00Z'));
        expect(api.addMatch).not.toHaveBeenCalled();

        // Run 2: the player syncs, the deferred match goes out after it.
        const secondStore: OfflineStore = {
            games: first.store.games,
            players: first.store.players.map((p) => ({ ...p, status: 'pending' as const, error: undefined })),
            matches: first.store.matches,
        };
        const second = await syncOffline(secondStore, api, noopPersist, () => secondStore, () => new Date('2026-06-12T00:00:00Z'));

        expect(api.addMatch).toHaveBeenCalledTimes(1);
        expect(second.store.matches).toHaveLength(0);
        expect(second.syncedCount).toBe(2);
    });
});

describe('op replay (ADR-37 phase 7)', () => {
    const opFixture = (over: Record<string, unknown> = {}) => ({
        entityId: '018f6b00-0000-7000-8000-0000000000e1' as Base58ID,
        kind: 'player' as const,
        op: 'update' as const,
        createdAt: '2026-06-01T12:00:00Z',
        status: 'pending' as const,
        base: { name: 'Вася' },
        patch: { name: 'Вася Обновлённый' },
        ...over,
    });

    // The server game record the merge merges against — every metadata field
    // present (null where unset), like OfflineContext's getGame builds it.
    const serverGame = (over: Partial<ServerGameFields> = {}): ServerGameFields => ({
        name: 'Каркассон',
        alias: null,
        name_en: 'Carcassonne',
        name_ru: 'Каркассон',
        bgg_ref: 822,
        tesera_ref: null,
        game_mode: 'competitive',
        ...over,
    });

    const gameOpBase = {
        alias: null,
        name_ru: 'Каркассон',
        name_en: 'Carcassonne',
        bgg_ref: 822,
        tesera_ref: null,
        game_mode: 'competitive' as const,
    };

    function okOpsApi() {
        return {
            getPlayer: vi.fn(async () => ({ ok: true, data: { name: 'Вася' } }) as SyncCallResult<{ name: string } | null>),
            patchPlayer: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<null>),
            deletePlayer: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<null>),
            getGame: vi.fn(async () => ({ ok: true, data: serverGame() }) as SyncCallResult<ServerGameFields | null>),
            patchGame: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<null>),
            deleteGame: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<null>),
            getMatch: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<ServerMatchFields | null>),
            putMatch: vi.fn(async () => ({ ok: true, data: null }) as SyncCallResult<null>),
        };
    }

    it('sends a clean player rename and drops the op', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const store = makeStore({ players: [] });
        store.ops = [opFixture()];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.patchPlayer).toHaveBeenCalledWith(store.ops![0].entityId, { name: 'Вася Обновлённый' });
        expect(outcome.store.ops).toHaveLength(0);
        expect(outcome.syncedCount).toBe(1);
    });

    it('turns a same-field race into a conflict instead of sending', async () => {
        const api = okApi();
        const ops = okOpsApi();
        // The server moved under the user: base "Вася" is now "Вася (новый)".
        ops.getPlayer.mockImplementation(async () => ({ ok: true, data: { name: 'Вася (новый)' } }) as SyncCallResult<{ name: string } | null>);
        const store = makeStore({});
        store.ops = [opFixture()];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.patchPlayer).not.toHaveBeenCalled();
        expect(outcome.store.ops).toHaveLength(1);
        expect(outcome.store.ops![0].status).toBe('conflict');
        expect(outcome.store.ops![0].conflict).toEqual([
            { field: 'name', label: 'Имя', ours: 'Вася Обновлённый', theirs: 'Вася (новый)' },
        ]);
    });

    it('takes the server value when the user did not touch the field', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const store = makeStore({});
        store.ops = [opFixture({ patch: { name: 'Вася' } })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        // Untouched → the server's value wins; the merged PATCH equals it.
        expect(ops.patchPlayer).toHaveBeenCalledWith(store.ops![0].entityId, { name: 'Вася' });
        expect(outcome.store.ops).toHaveLength(0);
    });

    it('syncs a game metadata edit cleanly when the server still holds the base', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const store = makeStore({});
        store.ops = [opFixture({ kind: 'game', base: gameOpBase, patch: { alias: 'каркассон' } })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        // The merge sees the real server metadata — no phantom conflict with
        // an empty «на сервере» side (regression: getGame used to return the
        // display name alone, so every changed key raced `undefined`).
        expect(ops.patchGame).toHaveBeenCalledTimes(1);
        const body = (ops.patchGame.mock.calls as unknown as [Base58ID, Record<string, unknown>][])[0][1];
        expect(body.alias).toBe('каркассон');
        // The display name derives server-side from alias → ru → en; it must
        // not travel in the PATCH.
        expect(body).not.toHaveProperty('name');
        expect(outcome.store.ops).toHaveLength(0);
        expect(outcome.syncedCount).toBe(1);
    });

    it('resolves a same-field game race and applies the user pick on the next sync', async () => {
        const api = okApi();
        const ops = okOpsApi();
        // Both sides changed name_ru — the sync flags it, /offline resolves.
        ops.getGame.mockImplementation(async () => ({ ok: true, data: serverGame({ name_ru: 'Каркассон (новое)' }) }));
        const store = makeStore({});
        store.ops = [opFixture({ kind: 'game', base: gameOpBase, patch: { name_ru: 'Каркассон (моя правка)' } })];

        const first = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);
        expect(ops.patchGame).not.toHaveBeenCalled();
        expect(first.store.ops![0].status).toBe('conflict');
        expect(first.store.ops![0].conflict).toEqual([
            { field: 'name_ru', label: 'Название (RU)', ours: 'Каркассон (моя правка)', theirs: 'Каркассон (новое)' },
        ]);

        // «Оставить моё» → resolveOpConflict → applyResolutions: the choice
        // becomes the patch, the server value the base. The next run must
        // send the user's value — not conflict again (the reported loop).
        const conflicted = first.store.ops![0];
        const resolved = applyResolutions(
            conflicted.base ?? {},
            conflicted.patch ?? {},
            conflicted.conflict ?? [],
            { name_ru: 'Каркассон (моя правка)' },
        );
        const second = await syncOffline(
            { ...store, ops: [{ ...conflicted, status: 'pending' as const, base: resolved.base, patch: resolved.patch }] },
            api,
            noopPersist,
            () => store,
            () => new Date(),
            ops,
        );

        expect(second.store.ops).toHaveLength(0);
        expect(second.syncedCount).toBe(1);
        expect(ops.patchGame).toHaveBeenCalledWith(
            conflicted.entityId,
            expect.objectContaining({ alias: null, name_ru: 'Каркассон (моя правка)' }),
        );
    });

    it('deletes a player when the server still holds the observed value', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const store = makeStore({});
        store.ops = [opFixture({ op: 'delete', patch: undefined })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.deletePlayer).toHaveBeenCalledTimes(1);
        expect(outcome.store.ops).toHaveLength(0);
    });

    it('guards a stale delete: the server value changed → conflict', async () => {
        const api = okApi();
        const ops = okOpsApi();
        ops.getPlayer.mockImplementation(async () => ({ ok: true, data: { name: 'Вася (новый)' } }) as SyncCallResult<{ name: string } | null>);
        const store = makeStore({});
        store.ops = [opFixture({ op: 'delete', patch: undefined })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.deletePlayer).not.toHaveBeenCalled();
        expect(outcome.store.ops![0].status).toBe('conflict');
        expect(outcome.store.ops![0].conflict![0].theirs).toBe('Вася (новый)');
    });

    it('drops a delete whose target is already gone (404)', async () => {
        const api = okApi();
        const ops = okOpsApi();
        ops.getPlayer.mockImplementation(async () => ({ ok: true, data: null }) as SyncCallResult<{ name: string } | null>);
        const store = makeStore({});
        store.ops = [opFixture({ op: 'delete', patch: undefined })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.deletePlayer).not.toHaveBeenCalled();
        expect(outcome.store.ops).toHaveLength(0);
    });

    it('merges match score per key and sends the PUT with the merged map', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const matchId = '018f6b00-0000-7000-8000-0000000000e2' as Base58ID;
        ops.getMatch.mockImplementation(async () => ({
            ok: true,
            data: {
                game_id: SERVER_GAME_ID,
                date: '2026-06-01T11:00:00Z',
                score: { p1: 10, p2: 25 },
                camp_arena_ids: [],
            },
        }) as SyncCallResult<{ game_id: Base58ID; date: string; score: Record<string, number>; camp_arena_ids: Base58ID[] } | null>);
        const store = makeStore({});
        store.ops = [opFixture({
            entityId: matchId,
            kind: 'match',
            tenant: '018f6b00-0000-7000-8000-000000000101' as Base58ID,
            base: { game_id: SERVER_GAME_ID, date: '2026-06-01T11:00:00Z', score: { p1: 10, p2: 20 }, camp_arena_ids: [] },
            patch: { game_id: SERVER_GAME_ID, date: '2026-06-01T11:00:00Z', score: { p1: 15, p2: 20 }, camp_arena_ids: [] },
        })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        // p1: user changed, server == base → apply; p2: untouched → server's.
        expect(ops.putMatch).toHaveBeenCalledWith(matchId, '018f6b00-0000-7000-8000-000000000101', expect.objectContaining({
            score: { p1: 15, p2: 25 },
        }));
        expect(outcome.store.ops).toHaveLength(0);
    });

    it('conflicts a match on a per-key score race', async () => {
        const api = okApi();
        const ops = okOpsApi();
        ops.getMatch.mockImplementation(async () => ({
            ok: true,
            data: {
                game_id: SERVER_GAME_ID,
                date: '2026-06-01T11:00:00Z',
                score: { p1: 12, p2: 25 },
                camp_arena_ids: [],
            },
        }) as SyncCallResult<{ game_id: Base58ID; date: string; score: Record<string, number>; camp_arena_ids: Base58ID[] } | null>);
        const store = makeStore({});
        store.ops = [opFixture({
            entityId: '018f6b00-0000-7000-8000-0000000000e2' as Base58ID,
            kind: 'match',
            base: { game_id: SERVER_GAME_ID, date: '2026-06-01T11:00:00Z', score: { p1: 10, p2: 20 }, camp_arena_ids: [] },
            patch: { game_id: SERVER_GAME_ID, date: '2026-06-01T11:00:00Z', score: { p1: 15, p2: 20 }, camp_arena_ids: [] },
        })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.putMatch).not.toHaveBeenCalled();
        expect(outcome.store.ops![0].status).toBe('conflict');
        expect(outcome.store.ops![0].conflict).toEqual([
            { field: 'score:p1', label: 'Счёт (p1)', ours: '15', theirs: '12' },
        ]);
    });

    it('leaves conflicted ops untouched for /offline resolution', async () => {
        const api = okApi();
        const ops = okOpsApi();
        const store = makeStore({});
        store.ops = [opFixture({ status: 'conflict' as const, conflict: [{ field: 'name', label: 'Имя', ours: 'a', theirs: 'b' }] })];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.getPlayer).not.toHaveBeenCalled();
        expect(outcome.store.ops).toHaveLength(1);
        expect(outcome.store.ops![0].status).toBe('conflict');
    });

    it('drops an update whose target no longer exists (server 404)', async () => {
        const api = okApi();
        const ops = okOpsApi();
        ops.getPlayer.mockImplementation(async () => ({ ok: false, status: 404, message: 'player not found' }) as SyncCallResult<{ name: string } | null>);
        const store = makeStore({});
        store.ops = [opFixture()];

        const outcome = await syncOffline(store, api, noopPersist, () => store, () => new Date(), ops);

        expect(ops.patchPlayer).not.toHaveBeenCalled();
        expect(outcome.store.ops).toHaveLength(0);
    });
});
