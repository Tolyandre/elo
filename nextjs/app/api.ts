import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./api-types.gen";
import { toast } from "sonner";

// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}

export const EloWebServiceBaseUrl = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

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

// ─── Re-exported schema types ─────────────────────────────────────────────────

export type EloRank = components["schemas"]["EloRank"];
export type Player = components["schemas"]["Player"];
export type User = components["schemas"]["User"];
export type Club = components["schemas"]["Club"];
export type GameList = components["schemas"]["GameList"];
export type GameListItem = components["schemas"]["GameListItem"];
export type Game = components["schemas"]["Game"];
export type GameMatchPlayer = components["schemas"]["GameMatchPlayer"];
export type EloSettingEntry = components["schemas"]["EloSettingEntry"];
export type Market = components["schemas"]["Market"];
export type MarketDetail = components["schemas"]["MarketDetail"];
export type MatchWinnerParams = components["schemas"]["MatchWinnerParams"];
export type WinStreakParams = components["schemas"]["WinStreakParams"];
export type SettlementDetail = components["schemas"]["SettlementDetail"];
export type VoiceParseResult = components["schemas"]["VoiceParseResult"];
export type SkullKingTableSummary = components["schemas"]["SkullKingTableSummary"];
export type SkullKingGameState = components["schemas"]["SkullKingGameState"];
export type SkullKingRoundEntry = components["schemas"]["SkullKingRoundEntry"];
export type SkullKingGamePhase = components["schemas"]["SkullKingGameState"]["phase"];
export type SkullKingCardImageResult = components["schemas"]["SkullKingCardImageResult"];
export type PlayerStats = components["schemas"]["PlayerStats"];
export type GameEloStat = components["schemas"]["GameEloStat"];
export type GameMatchStat = components["schemas"]["GameMatchStat"];

// ─── Frontend-specific types (differ from raw API response) ───────────────────

export type Period = keyof Player["rank"];

// score fields are camelCased; date is a Date object
export type PlayerScore = {
    ratingPay: number;
    ratingEarn: number;
    score: number;
};

export type Match = {
    id: number;
    game_id: string;
    game_name: string;
    date: Date | null;
    score: Record<string, PlayerScore>;
    has_markets: boolean;
};

// date is a Date object
export type GameMatch = {
    id: number;
    date: Date | null;
    players: GameMatchPlayer[];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapMatch(m: components["schemas"]["Match"]): Match {
    return {
        id: m.id,
        game_id: m.game_id,
        game_name: m.game_name,
        score: Object.fromEntries(
            Object.entries(m.score).map(([pid, s]) => [
                pid,
                { ratingPay: s.rating_pay, ratingEarn: s.rating_earn, score: s.score },
            ])
        ),
        date: m.date ? new Date(m.date) : null,
        has_markets: m.has_markets,
    };
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getPingPromise() {
    const { data, error } = await client.GET("/ping");
    if (error) throw error;
    return data;
}

export async function getPlayersPromise(): Promise<Player[]> {
    const { data, error } = await client.GET("/players");
    if (error) throw error;
    return data.data;
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

    const { data, error } = await client.GET("/matches", { params: { query } });
    if (error) throw error;
    return { items: data.data.map(mapMatch), next: data.next ?? null };
}

export async function getMatchByIdPromise(id: number): Promise<Match> {
    const { data, error } = await client.GET("/matches/{id}", { params: { path: { id: String(id) } } });
    if (error) throw error;
    return mapMatch(data.data);
}

export async function addMatchPromise(payload: { game_id: string, score: Record<string, number> }) {
    const { data, error } = await client.POST("/matches", { body: payload });
    if (error) throw error;
    return data.data;
}

export async function updateMatchPromise(matchId: number, payload: { game_id: string, score: Record<string, number>, date: string }) {
    const { data, error } = await client.PUT("/matches/{id}", {
        params: { path: { id: String(matchId) } },
        body: payload,
    });
    if (error) throw error;
    return data;
}

export async function getSettingsPromise(): Promise<components["schemas"]["Settings"]> {
    const { data, error } = await client.GET("/settings");
    if (error) throw error;
    return data.data;
}

export async function getGamesPromise(): Promise<GameList> {
    const { data, error } = await client.GET("/games");
    if (error) throw error;
    return data.data;
}

export async function getGamePromise(id: string): Promise<Game> {
    const { data, error } = await client.GET("/games/{id}", { params: { path: { id } } });
    if (error) throw error;
    return data.data;
}

export async function getGameMatchesPromise(gameId: string): Promise<GameMatch[]> {
    const { data, error } = await client.GET("/games/{id}/matches", { params: { path: { id: gameId } } });
    if (error) throw error;
    return data.data.map(m => ({
        id: m.id,
        date: m.date ? new Date(m.date) : null,
        players: m.players,
    }));
}

export async function patchGamePromise(id: string, payload: { name: string }) {
    const { data, error } = await client.PATCH("/games/{id}", {
        params: { path: { id } },
        body: payload,
    });
    if (error) throw error;
    return data.data;
}

export async function deleteGamePromise(id: string) {
    const { data, error } = await client.DELETE("/games/{id}", { params: { path: { id } } });
    if (error) throw error;
    return data;
}

export async function createGamePromise(payload: { name: string }) {
    const { data, error } = await client.POST("/games", { body: payload });
    if (error) throw error;
    return data.data;
}

export async function getMePromise(): Promise<User | undefined> {
    // Manual fetch: 401 returns undefined instead of throwing
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/auth/me`, { method: 'GET', credentials: 'include' });
        if (res.status === 401) return undefined;
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
    const { data, error } = await client.POST("/auth/logout");
    if (error) throw error;
    return data as Status;
}

export async function listUsersPromise(): Promise<User[]> {
    const { data, error } = await client.GET("/users");
    if (error) throw error;
    return data.data;
}

export async function patchMePromise(payload: { player_id: string | null }) {
    const { error } = await client.PATCH("/auth/me", { body: payload });
    if (error) throw error;
}

export async function patchUserPromise(userId: string, payload: { can_edit: boolean }) {
    const { data, error } = await client.PATCH("/users/{userId}", {
        params: { path: { userId } },
        body: payload,
    });
    if (error) throw error;
    return data.data;
}

export async function createPlayerPromise(payload: { name: string }) {
    const { data, error } = await client.POST("/players", { body: payload });
    if (error) throw error;
    return data.data;
}

export async function patchPlayerPromise(playerId: string, payload: { name: string }) {
    const { data, error } = await client.PATCH("/players/{id}", {
        params: { path: { id: playerId } },
        body: payload,
    });
    if (error) throw error;
    return data.data;
}

export async function deletePlayerPromise(playerId: string) {
    const { data, error } = await client.DELETE("/players/{id}", { params: { path: { id: playerId } } });
    if (error) throw error;
    return data;
}

export async function listClubsPromise(): Promise<Club[]> {
    const { data, error } = await client.GET("/clubs");
    if (error) throw error;
    return data.data;
}

export async function getClubPromise(id: string): Promise<Club> {
    const { data, error } = await client.GET("/clubs/{id}", { params: { path: { id } } });
    if (error) throw error;
    return data.data;
}

export async function createClubPromise(payload: { name: string }): Promise<Club> {
    const { data, error } = await client.POST("/clubs", { body: payload });
    if (error) throw error;
    return data.data;
}

export async function patchClubPromise(id: string, payload: { name: string }): Promise<Club> {
    const { data, error } = await client.PATCH("/clubs/{id}", {
        params: { path: { id } },
        body: payload,
    });
    if (error) throw error;
    return data.data;
}

export async function deleteClubPromise(id: string) {
    const { data, error } = await client.DELETE("/clubs/{id}", { params: { path: { id } } });
    if (error) throw error;
    return data;
}

export async function addClubMemberPromise(clubId: string, playerId: number) {
    const { data, error } = await client.POST("/clubs/{id}/members", {
        params: { path: { id: clubId } },
        body: { player_id: playerId },
    });
    if (error) throw error;
    return data;
}

export async function removeClubMemberPromise(clubId: string, playerId: number) {
    const { data, error } = await client.DELETE("/clubs/{id}/members/{playerId}", {
        params: { path: { id: clubId, playerId: String(playerId) } },
    });
    if (error) throw error;
    return data;
}

export async function listAllSettingsPromise(): Promise<EloSettingEntry[]> {
    const { data, error } = await client.GET("/settings/all");
    if (error) throw error;
    return data.data;
}

export async function createSettingsPromise(payload: {
    effective_date: string;
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
}): Promise<void> {
    const { error } = await client.POST("/settings", { body: payload });
    if (error) throw error;
}

export async function deleteSettingsPromise(effectiveDate: string): Promise<void> {
    const { error } = await client.DELETE("/settings", {
        body: { effective_date: effectiveDate },
    });
    if (error) throw error;
}

export async function getMarketsPromise(): Promise<{ active: Market[]; closed: Market[] }> {
    const { data, error } = await client.GET("/markets");
    if (error) throw error;
    return data.data;
}

export async function getMarketByIdPromise(id: string): Promise<MarketDetail> {
    const { data, error } = await client.GET("/markets/{id}", { params: { path: { id } } });
    if (error) throw error;
    return data.data;
}

export async function createMarketPromise(payload: {
    market_type: "match_winner" | "win_streak";
    starts_at: string | null;
    closes_at: string;
    target_player_id: string;
    required_player_ids?: string[];
    game_ids?: string[];
    streak_game_ids?: string[];
    wins_required?: number | null;
    max_losses?: number | null;
}): Promise<{ id: string }> {
    const { data, error } = await client.POST("/markets", {
        body: {
            ...payload,
            starts_at: payload.starts_at ?? undefined,
            wins_required: payload.wins_required ?? undefined,
        },
    });
    if (error) throw error;
    return data.data;
}

export async function deleteMarketPromise(id: string): Promise<void> {
    const { error } = await client.DELETE("/markets/{id}", { params: { path: { id } } });
    if (error) throw error;
}

export async function closeMarketBettingPromise(id: string): Promise<void> {
    const { error } = await client.PATCH("/markets/{id}", {
        params: { path: { id } },
        body: { status: "betting_closed" },
    });
    if (error) throw error;
}

export async function getMarketsByMatchIdPromise(matchId: number): Promise<Market[]> {
    const { data, error } = await client.GET("/matches/{id}/markets", {
        params: { path: { id: String(matchId) } },
    });
    if (error) throw error;
    return data.data ?? [];
}

export async function placeBetPromise(marketId: string, outcome: 'yes' | 'no', amount: number): Promise<void> {
    const { error } = await client.POST("/markets/{id}/bets", {
        params: { path: { id: marketId } },
        body: { outcome, amount },
    });
    if (error) throw error;
}

export async function getPlayerStatsPromise(id: string): Promise<PlayerStats> {
    const { data, error } = await client.GET("/players/{id}/stats", { params: { path: { id } } });
    if (error) throw error;
    return data.data;
}

export async function parseVoiceInput(text: string): Promise<VoiceParseResult> {
    const { data, error } = await client.POST("/voice/parse", { body: { text } });
    if (error) throw error;
    return data.data;
}

export async function parseSkullKingCardImagePromise(imageBase64: string): Promise<SkullKingCardImageResult> {
    const { data, error } = await client.POST("/skull-king/parse-card-image", {
        body: { image: imageBase64 },
    });
    if (error) throw error;
    return data.data;
}

// ─── Skull King table API ─────────────────────────────────────────────────────

export async function listSkullKingTablesPromise(): Promise<SkullKingTableSummary[]> {
    const { data, error } = await client.GET("/skull-king/tables");
    if (error) throw error;
    return data.data;
}

export async function createSkullKingTablePromise(gameState: SkullKingGameState): Promise<SkullKingTableSummary> {
    const { data, error } = await client.POST("/skull-king/tables", { body: { game_state: gameState } });
    if (error) throw error;
    return data.data;
}

export async function getSkullKingTablePromise(tableId: string): Promise<SkullKingTableSummary> {
    const { data, error } = await client.GET("/skull-king/tables/{id}", { params: { path: { id: tableId } } });
    if (error) throw error;
    return data.data;
}

export async function updateSkullKingTableStatePromise(tableId: string, gameState: SkullKingGameState): Promise<SkullKingTableSummary> {
    const { data, error } = await client.PATCH("/skull-king/tables/{id}/state", {
        params: { path: { id: tableId } },
        body: { game_state: gameState },
    });
    if (error) throw error;
    return data.data;
}

export async function joinSkullKingTablePromise(tableId: string): Promise<SkullKingTableSummary> {
    const { data, error } = await client.POST("/skull-king/tables/{id}/join", {
        params: { path: { id: tableId } },
    });
    if (error) throw error;
    return data.data;
}

export async function submitSkullKingBidPromise(tableId: string, bid: number): Promise<SkullKingTableSummary> {
    const { data, error } = await client.POST("/skull-king/tables/{id}/bid", {
        params: { path: { id: tableId } },
        body: { bid },
    });
    if (error) throw error;
    return data.data;
}

export async function submitSkullKingResultPromise(tableId: string, actual: number, bonus: number): Promise<SkullKingTableSummary> {
    const { data, error } = await client.POST("/skull-king/tables/{id}/result", {
        params: { path: { id: tableId } },
        body: { actual, bonus },
    });
    if (error) throw error;
    return data.data;
}

export async function deleteSkullKingTablePromise(tableId: string): Promise<void> {
    const { error } = await client.DELETE("/skull-king/tables/{id}", {
        params: { path: { id: tableId } },
    });
    if (error) throw error;
}
