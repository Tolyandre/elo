import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./api-types.gen";
import { toast } from "sonner";
import { uuidv7 } from "uuidv7";
import { Base58ID, encodeId } from "../lib/id";
import { getTableClientToken } from "../lib/table-client";

// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}

export const EloWebServiceBaseUrl = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

/** Mint a client-side id: a UUIDv7 encoded as a short Base58 string. */
function newId(): Base58ID {
    return encodeId(uuidv7());
}

/**
 * Unwrap an openapi-fetch response, throwing a proper Error on failure.
 * openapi-fetch returns `{ data, error }` rather than throwing; this collapses
 * the repeated `if (error) throwApiError(error); return data.data` boilerplate.
 * Returns the success body (the full envelope); callers read `.data` etc. off it.
 * Failures throw an ApiError carrying the HTTP status when there was a response.
 */
async function unwrap<D>(promise: Promise<{ data?: D; error?: unknown; response?: Response }>): Promise<D> {
    const { data, error, response } = await promise;
    if (error) throwApiError(error, response?.status);
    return data as D;
}

// ─── openapi-fetch client ─────────────────────────────────────────────────────

const errorToastMiddleware: Middleware = {
    async onResponse({ response }) {
        if (!response.ok) {
            const body = await response.clone().json().catch(() => null);
            const msg = body?.message ?? `Ошибка ${response.status}`;
            toast.error(msg);
        }
        return response;
    },
};

export const client = createClient<paths>({
    baseUrl: EloWebServiceBaseUrl,
    credentials: "include",
});
client.use(errorToastMiddleware);

/** Thrown when the server is unreachable (no network), as opposed to an HTTP error. */
export class NetworkError extends Error {
    constructor(message = "Нет соединения с сервером") {
        super(message);
        this.name = "NetworkError";
    }
}

/** True for errors meaning "request never reached the server" (fetch rejects with TypeError). */
export function isNetworkFailure(e: unknown): boolean {
    return e instanceof NetworkError || e instanceof TypeError;
}

/**
 * An API error with a known HTTP status (there was a response). Lets callers
 * distinguish definitive outcomes — 404 table gone, 409 conflict — from
 * transient ones (network failures, 5xx during a restart).
 */
export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

/**
 * Throws a proper Error carrying the server's message from an openapi-fetch error body.
 * openapi-fetch returns the parsed error object (`{ status, message }`) rather than an
 * Error instance; throwing it verbatim makes `instanceof Error` fail and produces
 * "[object Object]" in catch blocks. This wraps it so `.message` works everywhere.
 * When an HTTP status is available the error is an ApiError exposing it.
 */
export function throwApiError(error: unknown, status?: number): never {
    if (error && typeof error === "object" && "message" in error) {
        const m = (error as { message?: unknown }).message;
        if (typeof m === "string" && m.length > 0) {
            if (status !== undefined) throw new ApiError(m, status);
            throw new Error(m);
        }
    }
    throw new Error("Request failed");
}

/**
 * Best-effort message from a thrown API error. The openapi-fetch helpers throw the parsed
 * error body (`{ status, message }`, not an Error), so reading `.message` covers both that
 * shape and real Error instances.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
    if (e && typeof e === "object" && "message" in e) {
        const m = (e as { message?: unknown }).message;
        if (typeof m === "string" && m.length > 0) return m;
    }
    return fallback;
}

// ─── Re-exported schema types ─────────────────────────────────────────────────

export type EloRank = components["schemas"]["EloRank"];
export type Player = components["schemas"]["Player"];
export type User = components["schemas"]["User"];
export type Club = components["schemas"]["Club"];
export type Tournament = components["schemas"]["Tournament"];
export type TournamentStats = components["schemas"]["TournamentStats"];
export type TournamentStatsPlayer = components["schemas"]["TournamentStatsPlayer"];
export type GameList = components["schemas"]["GameList"];
export type GameListItem = components["schemas"]["GameListItem"];
export type Game = components["schemas"]["Game"];
export type GameMatchPlayer = components["schemas"]["GameMatchPlayer"];
export type EloSettingEntry = components["schemas"]["EloSettingEntry"];
export type Market = components["schemas"]["Market"];
export type MarketDetail = components["schemas"]["MarketDetail"];
export type MarketOutcome = components["schemas"]["MarketOutcome"];
export type MatchWinnerParams = components["schemas"]["MatchWinnerParams"];
export type WinStreakParams = components["schemas"]["WinStreakParams"];
export type SettlementDetail = components["schemas"]["SettlementDetail"];
export type VoiceParseResult = components["schemas"]["VoiceParseResult"];
export type TableSummary = components["schemas"]["TableSummary"];
export type TableGameState = components["schemas"]["TableGameState"];
export type TablePlayer = components["schemas"]["TablePlayer"];
export type SkullKingGameState = components["schemas"]["SkullKingGameState"];
export type SkullKingRoundEntry = components["schemas"]["SkullKingRoundEntry"];
export type SkullKingGamePhase = components["schemas"]["SkullKingGameState"]["phase"];
export type IawwGameState = components["schemas"]["IawwGameState"];
export type IawwEntry = components["schemas"]["IawwEntry"];
export type IawwCell = components["schemas"]["IawwCell"];
export type IawwScoreInput = components["schemas"]["IawwScoreInput"];
export type TableSubmitInput =
    | components["schemas"]["SkullKingBidInput"]
    | components["schemas"]["SkullKingResultInput"]
    | components["schemas"]["IawwScoreInput"];
export type SkullKingCardImageResult = components["schemas"]["SkullKingCardImageResult"];
export type PlayerStats = components["schemas"]["PlayerStats"];
export type GameEloStat = components["schemas"]["GameEloStat"];
export type GameMatchStat = components["schemas"]["GameMatchStat"];

// ─── Frontend-specific types (differ from raw API response) ───────────────────

export type Period = keyof Player["rank"];

// score fields are camelCased; date is a Date object
export type PlayerScore = {
    ratingStaked: number;
    ratingEarned: number;
    score: number;
    ratingAfter?: number | null;
};

export type MatchTournament = components["schemas"]["MatchTournament"];

export type Match = {
    id: Base58ID;
    game_id: Base58ID;
    game_name: string;
    date: Date | null;
    /**
     * Raw server date string (RFC3339 with microsecond precision). JS Date
     * only holds milliseconds, so edit forms must resubmit this verbatim when
     * the date is untouched — a Date round-trip silently truncates the
     * stored instant and the audit log reports a change nobody made.
     */
    dateISO: string | null;
    score: Record<string, PlayerScore>;
    has_markets: boolean;
    tournaments: MatchTournament[];
    /** Set when the match was created via a calculator; selects the calculator UI in history mode. */
    calculator_kind?: string | null;
    /** Intermediate calculator state (opaque to the API layer). */
    calculator_data?: Record<string, unknown> | null;
};

// date is a Date object
export type GameMatch = {
    id: Base58ID;
    date: Date | null;
    players: GameMatchPlayer[];
    tournaments: MatchTournament[];
};

export type Status = {
    status: "success" | "fail";
    error?: string;
};

export type MatchesPage = {
    items: Match[];
    next: string | null;
};

export type RatingPoint = { date: string; rating: number };

// date is a Date object
export type Correction = {
    id: Base58ID;
    player_id: Base58ID;
    player_name: string;
    diff: number;
    date: Date | null;
};

export type CorrectionsPage = {
    items: Correction[];
    next: string | null;
};

// ─── Audit ────────────────────────────────────────────────────────────────────

export type AuditEntityType = "match" | "game" | "player" | "club";
export type AuditAction = "created" | "updated" | "renamed" | "deleted";

/** Details narrowed into a discriminated union by action/entity_type. */
export type AuditEntryDetails =
    | { kind: "entity"; name: string }
    | { kind: "rename"; oldName: string; newName: string }
    | { kind: "match-update"; changes: components["schemas"]["AuditMatchUpdateDetails"] };

export type AuditEntry = {
    id: Base58ID;
    created_at: Date;
    actor_user_id: Base58ID;
    actor_name: string;
    entity_type: AuditEntityType;
    entity_id: Base58ID;
    action: AuditAction;
    details: AuditEntryDetails | null;
};

export type AuditPage = {
    items: AuditEntry[];
    next: string | null;
};

function mapAuditEntry(e: components["schemas"]["AuditEntry"]): AuditEntry {
    let details: AuditEntryDetails | null = null;
    if (e.details) {
        if (e.action === "renamed" && "old_name" in e.details) {
            details = { kind: "rename", oldName: e.details.old_name, newName: e.details.new_name };
        } else if (e.action === "updated" && "player_changes" in e.details) {
            details = { kind: "match-update", changes: e.details };
        } else if ("name" in e.details) {
            details = { kind: "entity", name: e.details.name };
        }
    }
    return {
        id: e.id,
        created_at: new Date(e.created_at),
        actor_user_id: e.actor_user_id,
        actor_name: e.actor_name,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        action: e.action,
        details,
    };
}

export async function getAuditPagePromise(params?: {
    entity_type?: AuditEntityType;
    entity_id?: string;
    next?: string;
    limit?: number;
}): Promise<AuditPage> {
    const query: Record<string, string> = {};
    if (params?.next) {
        // The cursor token embeds the filters; only limit is repeated.
        query.next = params.next;
    } else {
        if (params?.entity_type) query.entity_type = params.entity_type;
        if (params?.entity_id) query.entity_id = params.entity_id;
    }
    if (params?.limit) query.limit = String(params.limit);
    const data = await unwrap(client.GET("/audit", { params: { query } }));
    return {
        items: data.data.map(mapAuditEntry),
        next: data.next ?? null,
    };
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapMatch(m: components["schemas"]["Match"]): Match {
    return {
        id: m.id,
        game_id: m.game_id,
        game_name: m.game_name,
        score: Object.fromEntries(
            Object.entries(m.score).map(([pid, s]) => [
                pid,
                { ratingStaked: s.rating_staked, ratingEarned: s.rating_earned, score: s.score, ratingAfter: s.rating_after },
            ])
        ),
        date: m.date ? new Date(m.date) : null,
        dateISO: m.date ?? null,
        has_markets: m.has_markets,
        tournaments: m.tournaments ?? [],
        // idcodec middleware already rewrote player ids inside calculator_data to
        // short form on the way out, so no client-side transformation is needed.
        calculator_kind: m.calculator_kind ?? null,
        calculator_data: (m.calculator_data as Record<string, unknown> | null) ?? null,
    };
}

// ─── API functions ────────────────────────────────────────────────────────────

// Lightweight API health check used by the offline indicator. Uses a raw fetch
// (not the openapi client) to avoid the error toast middleware on failure, and
// returns a boolean instead of throwing. The service worker serves /ping as
// NetworkOnly, so the result reflects the real API state. A timeout treats a
// hanging server (no response, not a refused connection) as unreachable.
export async function pingApiPromise(timeoutMs = 8000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/ping`, {
            method: "GET",
            credentials: "include",
            signal: controller.signal,
        });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export async function getPlayersPromise(): Promise<Player[]> {
    return (await unwrap(client.GET("/players"))).data;
}

export async function getMatchesPagePromise(params?: {
    player_id?: string;
    game_id?: string;
    club_id?: string;
    next?: string;
    limit?: number;
}): Promise<MatchesPage> {
    const query: Record<string, string | number> = {};
    if (params?.next) {
        // Continuation mode: search params are encoded in the cursor.
        query.next = params.next;
    } else {
        // Initial mode: pass search params explicitly.
        if (params?.player_id) query.player_id = params.player_id;
        if (params?.game_id) query.game_id = params.game_id;
        if (params?.club_id) query.club_id = params.club_id;
    }
    if (params?.limit) query.limit = params.limit;

    const data = await unwrap(client.GET("/matches", { params: { query } }));
    return { items: data.data.map(mapMatch), next: data.next ?? null };
}

export async function getCorrectionsPagePromise(params?: {
    player_id?: string;
    club_id?: string;
    next?: string;
}): Promise<CorrectionsPage> {
    const query: Record<string, string> = {};
    if (params?.next) {
        query.next = params.next;
    } else {
        if (params?.player_id) query.player_id = params.player_id;
        if (params?.club_id) query.club_id = params.club_id;
    }
    const data = await unwrap(client.GET("/corrections", { params: { query } }));
    return {
        items: data.data.map(c => ({
            id: c.id,
            player_id: c.player_id,
            player_name: c.player_name,
            diff: c.diff,
            date: c.date ? new Date(c.date) : null,
        })),
        next: data.next ?? null,
    };
}

export async function getMatchByIdPromise(id: Base58ID): Promise<Match> {
    return mapMatch((await unwrap(client.GET("/matches/{id}", { params: { path: { id } } }))).data);
}

export async function addMatchPromise(payload: {
    id: Base58ID;
    game_id: Base58ID;
    score: Record<string, number>;
    date?: string;
    tournament_ids?: Base58ID[];
    calculator_kind?: string | null;
    calculator_data?: Record<string, never> | null;
}) {
    return (await unwrap(client.POST("/matches", { body: payload }))).data;
}

export async function updateMatchPromise(matchId: Base58ID, payload: {
    game_id: Base58ID;
    score: Record<string, number>;
    date: string;
    tournament_ids?: Base58ID[];
    calculator_kind?: string | null;
    calculator_data?: Record<string, never> | null;
}) {
    const data = await unwrap(client.PUT("/matches/{id}", {
        params: { path: { id: matchId } },
        body: payload,
    }));
    return data;
}

export async function getSettingsPromise(): Promise<components["schemas"]["Settings"]> {
    return (await unwrap(client.GET("/settings"))).data;
}

export async function getGamesPromise(): Promise<GameList> {
    return (await unwrap(client.GET("/games"))).data;
}

export async function getGamePromise(id: Base58ID): Promise<Game> {
    return (await unwrap(client.GET("/games/{id}", { params: { path: { id } } }))).data;
}

export async function getGameMatchesPromise(gameId: Base58ID): Promise<GameMatch[]> {
    const data = await unwrap(client.GET("/games/{id}/matches", { params: { path: { id: gameId } } }));
    return data.data.map(m => ({
        id: m.id,
        date: m.date ? new Date(m.date) : null,
        players: m.players,
        tournaments: m.tournaments ?? [],
    }));
}

export async function patchGamePromise(id: Base58ID, payload: { name: string }) {
    return (await unwrap(client.PATCH("/games/{id}", { params: { path: { id } }, body: payload }))).data;
}

export async function deleteGamePromise(id: Base58ID) {
    return unwrap(client.DELETE("/games/{id}", { params: { path: { id } } }));
}

export async function getMePromise(): Promise<User | undefined> {
    // Manual fetch: 401 returns undefined instead of throwing.
    // A network failure throws NetworkError without a toast so the caller can
    // fall back to a cached identity while offline.
    let res: Response;
    try {
        res = await fetch(`${EloWebServiceBaseUrl}/auth/me`, { method: 'GET', credentials: 'include' });
    } catch {
        throw new NetworkError();
    }
    if (res.status === 401) return undefined;
    try {
        const body = await res.json();
        if (body.status === "fail") throw new Error(body.message);
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        return body.data as User;
    } catch (error) {
        if (error instanceof Error) toast.error(error.message);
        throw error;
    }
}

export async function oauth2Callback(params?: Record<string, string | string[]>): Promise<Status> {
    // Manual fetch: non-standard query param assembly
    try {
        let url = `${EloWebServiceBaseUrl}/auth/oauth2-callback`;
        if (params && Object.keys(params).length > 0) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (Array.isArray(value)) {
                    for (const v of value) searchParams.append(key, v);
                } else if (value !== undefined && value !== null) {
                    searchParams.append(key, String(value));
                }
            }
            url += `?${searchParams.toString()}`;
        }
        const res = await fetch(url, { method: 'GET', credentials: 'include' });
        const body = await res.json();
        if (body.status === "fail") throw new Error(body.message);
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        return body;
    } catch (error) {
        if (error instanceof Error) toast.error(error.message);
        throw error;
    }
}

export async function logout(): Promise<Status> {
    return unwrap(client.POST("/auth/logout")) as Promise<Status>;
}

export async function listUsersPromise(): Promise<User[]> {
    return (await unwrap(client.GET("/users"))).data;
}

export async function patchMePromise(payload: { player_id: Base58ID | null }) {
    await unwrap(client.PATCH("/auth/me", { body: payload }));
}

export async function patchUserPromise(userId: Base58ID, payload: { can_edit: boolean }) {
    return (await unwrap(client.PATCH("/users/{userId}", {
        params: { path: { userId } },
        body: payload,
    }))).data;
}

export async function patchPlayerPromise(playerId: Base58ID, payload: { name: string }) {
    return (await unwrap(client.PATCH("/players/{id}", {
        params: { path: { id: playerId } },
        body: payload,
    }))).data;
}

export async function deletePlayerPromise(playerId: Base58ID) {
    return unwrap(client.DELETE("/players/{id}", { params: { path: { id: playerId } } }));
}

export async function createPlayerCorrectionPromise(playerId: Base58ID, diff: number) {
    return unwrap(client.POST("/admin/players/{id}/corrections", {
        params: { path: { id: playerId } },
        body: { id: newId(), discriminator: "correction", diff },
    }));
}

export async function listClubsPromise(): Promise<Club[]> {
    return (await unwrap(client.GET("/clubs"))).data;
}

export async function getClubPromise(id: Base58ID): Promise<Club> {
    return (await unwrap(client.GET("/clubs/{id}", { params: { path: { id } } }))).data;
}

export async function createClubPromise(payload: { name: string }): Promise<Club> {
    return (await unwrap(client.POST("/clubs", { body: { id: newId(), ...payload } }))).data;
}

export async function patchClubPromise(
    id: Base58ID,
    payload: { name?: string; icon?: string },
): Promise<Club> {
    return (await unwrap(client.PATCH("/clubs/{id}", {
        params: { path: { id } },
        body: payload,
    }))).data;
}

export async function deleteClubPromise(id: Base58ID) {
    return unwrap(client.DELETE("/clubs/{id}", { params: { path: { id } } }));
}

export async function addClubMemberPromise(clubId: Base58ID, playerId: Base58ID) {
    return unwrap(client.POST("/clubs/{id}/members", {
        params: { path: { id: clubId } },
        body: { player_id: playerId },
    }));
}

export async function removeClubMemberPromise(clubId: Base58ID, playerId: Base58ID) {
    return unwrap(client.DELETE("/clubs/{id}/members/{playerId}", {
        params: { path: { id: clubId, playerId } },
    }));
}

export async function listTournamentsPromise(): Promise<Tournament[]> {
    return (await unwrap(client.GET("/tournaments"))).data;
}

export async function getTournamentPromise(id: Base58ID): Promise<Tournament> {
    return (await unwrap(client.GET("/tournaments/{id}", { params: { path: { id } } }))).data;
}

export async function createTournamentPromise(payload: { name: string; start_date: string; end_date: string; player_ids?: Base58ID[] }): Promise<Tournament> {
    return (await unwrap(client.POST("/tournaments", { body: { id: newId(), ...payload } }))).data;
}

export async function updateTournamentPromise(id: Base58ID, payload: { name: string; start_date: string; end_date: string; player_ids: Base58ID[] }): Promise<Tournament> {
    return (await unwrap(client.PUT("/tournaments/{id}", {
        params: { path: { id } },
        body: { id, ...payload },
    }))).data;
}

export async function deleteTournamentPromise(id: Base58ID) {
    return unwrap(client.DELETE("/tournaments/{id}", { params: { path: { id } } }));
}

export async function getTournamentStatsPromise(id: Base58ID): Promise<TournamentStats> {
    return (await unwrap(client.GET("/tournaments/{id}/stats", { params: { path: { id } } }))).data;
}

export async function listAllSettingsPromise(): Promise<EloSettingEntry[]> {
    return (await unwrap(client.GET("/settings/all"))).data;
}

export async function createSettingsPromise(payload: {
    effective_date: string;
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
}): Promise<void> {
    await unwrap(client.POST("/settings", { body: payload }));
}

export async function deleteSettingsPromise(effectiveDate: string): Promise<void> {
    await unwrap(client.DELETE("/settings", {
        body: { effective_date: effectiveDate },
    }));
}

export async function getMarketsPromise(): Promise<{ active: Market[]; closed: Market[] }> {
    return (await unwrap(client.GET("/markets"))).data;
}

export async function getMarketByIdPromise(id: Base58ID): Promise<MarketDetail> {
    return (await unwrap(client.GET("/markets/{id}", { params: { path: { id } } }))).data;
}

export interface MarketProbabilityPoint {
    t: string;
    probabilities: { outcome_id: Base58ID; probability: number }[];
}

// The probability history is reconstructed server-side by replaying the bet
// stream through the LMSR; each point carries the probability (LMSR marginal
// price) of every outcome right after a bet (the probabilities sum to 1).
export async function getMarketProbabilityHistoryPromise(id: Base58ID): Promise<MarketProbabilityPoint[]> {
    return (await unwrap(client.GET("/markets/{id}/probability-history", { params: { path: { id } } }))).data.points;
}

export async function createMarketPromise(payload: {
    market_type: "match_winner" | "win_streak";
    starts_at: string | null;
    closes_at: string;
    target_player_ids?: Base58ID[];
    allow_other_players?: boolean;
    game_ids?: Base58ID[];
    target_player_id?: Base58ID;
    streak_game_ids?: Base58ID[];
    wins_required?: number | null;
    max_losses?: number | null;
    guarantor_player_ids?: Base58ID[];
    liquidity_b?: number;
}): Promise<{ id: Base58ID }> {
    return (await unwrap(client.POST("/markets", {
        body: {
            id: newId(),
            ...payload,
            starts_at: payload.starts_at ?? undefined,
            wins_required: payload.wins_required ?? undefined,
            guarantor_player_ids: payload.guarantor_player_ids ?? undefined,
            liquidity_b: payload.liquidity_b,
        },
    }))).data;
}

export async function deleteMarketPromise(id: Base58ID): Promise<void> {
    await unwrap(client.DELETE("/markets/{id}", { params: { path: { id } } }));
}

export async function closeMarketBettingPromise(id: Base58ID): Promise<void> {
    await unwrap(client.PATCH("/markets/{id}", {
        params: { path: { id } },
        body: { status: "betting_closed" },
    }));
}

export async function getMarketsByMatchIdPromise(matchId: Base58ID): Promise<Market[]> {
    return (await unwrap(client.GET("/matches/{id}/markets", {
        params: { path: { id: matchId } },
    }))).data ?? [];
}

export async function placeBetPromise(marketId: Base58ID, outcomeId: Base58ID, expectedProbability: number, shares = 1): Promise<{ shares: number; cost_per_share: number }> {
    // Shares-driven buy (ADR-10): the AMM prices the elo cost of `shares`
    // (default one share; the fixed-amount mode inverts the LMSR cost client
    // side to get the share count for its amount). expectedProbability is the
    // outcome probability the user saw — the server rejects the bet (409) if
    // the live probability has moved beyond a tolerance.
    const res = await unwrap(client.POST("/markets/{id}/bets", {
        params: { path: { id: marketId } },
        body: { id: newId(), outcome_id: outcomeId, shares, expected_probability: expectedProbability },
    }));
    return { shares: res.data.shares, cost_per_share: res.data.cost_per_share };
}

export async function getPlayerStatsPromise(id: Base58ID): Promise<PlayerStats> {
    return (await unwrap(client.GET("/players/{id}/stats", { params: { path: { id } } }))).data;
}

export async function parseVoiceInput(text: string): Promise<VoiceParseResult> {
    return (await unwrap(client.POST("/voice/parse", { body: { text } }))).data;
}

export async function parseSkullKingCardImagePromise(imageBase64: string): Promise<SkullKingCardImageResult> {
    return (await unwrap(client.POST("/skull-king/parse-card-image", {
        body: { image: imageBase64 },
    }))).data;
}

// ─── Live game table API (generic; per-game payloads, ADR-16) ────────────────

export async function listTablesPromise(): Promise<TableSummary[]> {
    return (await unwrap(client.GET("/tables"))).data;
}

export async function createTablePromise(gameId: Base58ID, gameState: TableGameState): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables", {
        body: { id: newId(), game_id: gameId, host_client_token: getTableClientToken(), game_state: gameState },
    }))).data;
}

export async function getTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.GET("/tables/{id}", { params: { path: { id: tableId } } }))).data;
}

/** Result of a host state patch: ok, or a version conflict carrying the current table. */
export type TableStateUpdate =
    | { status: "ok"; table: TableSummary }
    | { status: "conflict"; table: TableSummary };

export async function updateTableState(tableId: Base58ID, version: number, gameState: TableGameState): Promise<TableStateUpdate> {
    const { data, error, response } = await client.PATCH("/tables/{id}/state", {
        params: { path: { id: tableId } },
        body: { version, game_state: gameState },
    });
    if (error) {
        // 409 carries the current table so the caller can merge its edit and
        // retry instead of erasing another writer's input.
        if (response.status === 409) {
            return { status: "conflict", table: (error as { data: TableSummary }).data };
        }
        throwApiError(error);
    }
    return { status: "ok", table: (data as { data: TableSummary }).data };
}

export async function joinTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/join", {
        params: { path: { id: tableId } },
    }))).data;
}

/**
 * Claim hosting of the table for this device (the current host may always
 * re-claim — this is also host resume on another device; everyone else needs
 * edit permission). Broadcasts the new claim so the previous host device
 * steps down.
 */
export async function takeoverTablePromise(tableId: Base58ID): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/takeover", {
        params: { path: { id: tableId } },
        body: { host_client_token: getTableClientToken() },
    }))).data;
}

export async function submitTablePromise(tableId: Base58ID, input: TableSubmitInput): Promise<TableSummary> {
    return (await unwrap(client.POST("/tables/{id}/submit", {
        params: { path: { id: tableId } },
        body: input,
    }))).data;
}

export async function deleteTablePromise(tableId: Base58ID, matchId?: string): Promise<void> {
    await unwrap(client.DELETE("/tables/{id}", {
        params: {
            path: { id: tableId },
            ...(matchId ? { query: { match_id: matchId } } : {}),
        },
    }));
}
