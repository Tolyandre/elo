import { toast } from "sonner";

// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}

export const EloWebServiceBaseUrl = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

export type EloRank = {
    elo: number;
    rank: number | null;
    matches_left_for_ranked: number
}

export type Player = {
    id: string;
    name: string;
    geologist_name?: string | null;
    user_id?: string | null;
    rank: {
        now: EloRank;
        day_ago: EloRank;
        week_ago: EloRank;
    }
};

export type Period = keyof Player["rank"];

export type User = {
    id: string;
    name: string;
    can_edit: boolean;
    player_id?: string | null;
}

export type Status = {
    status: "success" | "fail";
    error?: string;
}

export type Club = {
    id: string;
    name: string;
    geologist_name?: string | null;
    players: number[];
};

export type GameList = {
    games: GameListItem[];
};

export type GameListItem = {
    id: string;
    name: string;
    total_matches: number;
    last_played_order: number;
};

export type Game = {
    id: string;
    name: string;
    total_matches: number;
    players: {
        id: string;
        elo: number;
        rank: number;
    }[];
};

export type Match = {
    id: number;
    game_id: string;
    game_name: string;
    date: Date | null;
    score: Record<string, PlayerScore>;
    has_markets: boolean;
};

export type PlayerScore = {
    ratingPay: number;
    ratingEarn: number;
    score: number;
};

export type GameMatchPlayer = {
    id: string;
    name: string;
    score: number;
    game_elo_pay: number;
    game_elo_earn: number;
    game_new_elo: number;
};

export type GameMatch = {
    id: number;
    date: Date | null;
    players: GameMatchPlayer[];
};

export async function getPingPromise() {
    var res = await fetch(`${EloWebServiceBaseUrl}/ping`);
    return await handleJsonErrorResponse(res);
}

export async function getPlayersPromise(): Promise<Player[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/players`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export type MatchesPage = {
    items: Match[];
    next: string | null;
};

export async function getMatchesPagePromise(params?: {
    player_id?: string;
    game_id?: string;
    club_id?: string;
    next?: string;
    limit?: number;
}): Promise<MatchesPage> {
    try {
        const query = new URLSearchParams();
        if (params?.next) {
            // Continuation mode: search params are encoded in the cursor.
            query.set("next", params.next);
        } else {
            // Initial mode: pass search params explicitly.
            if (params?.player_id) query.set("player_id", params.player_id);
            if (params?.game_id) query.set("game_id", params.game_id);
            if (params?.club_id) query.set("club_id", params.club_id);
        }
        if (params?.limit) query.set("limit", String(params.limit));
        const qs = query.toString();
        const res = await fetch(`${EloWebServiceBaseUrl}/matches${qs ? `?${qs}` : ""}`);
        let body: any;
        try { body = await res.json(); } catch { throw new Error(`Ошибка ${res.status}`); }
        if (body.status === "fail") throw new Error(body.message);
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        const items: Match[] = (body.data as any[]).map(m => ({
            id: m.id,
            game_id: m.game_id,
            game_name: m.game_name,
            score: Object.fromEntries(
                Object.entries(m.score as Record<string, any>).map(([pid, s]) => [
                    pid,
                    { ratingPay: s.rating_pay, ratingEarn: s.rating_earn, score: s.score },
                ])
            ),
            date: m.date ? new Date(m.date) : null,
            has_markets: m.has_markets ?? false,
        }));
        return { items, next: body.next ?? null };
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getMatchByIdPromise(id: number): Promise<Match> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/matches/${id}`);
        const m: any = await handleJsonErrorResponse(res);
        return {
            id: m.id,
            game_id: m.game_id,
            game_name: m.game_name,
            score: Object.fromEntries(
                Object.entries(m.score as Record<string, any>).map(([pid, s]) => [
                    pid,
                    { ratingPay: s.rating_pay, ratingEarn: s.rating_earn, score: s.score },
                ])
            ),
            date: m.date ? new Date(m.date) : null,
            has_markets: m.has_markets ?? false,
        };
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function addMatchPromise(payload: { game_id: string, score: Record<string, number> }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/matches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function updateMatchPromise(matchId: number, payload: { game_id: string, score: Record<string, number>, date: string }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export type EloSettingEntry = {
    effective_date: string;
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
}

export async function getSettingsPromise(): Promise<{
    elo_const_k: number,
    elo_const_d: number,
    starting_elo: number,
    win_reward: number,
}> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/settings`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getGamesPromise(): Promise<GameList> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getGamePromise(id: string): Promise<Game> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games/${id}`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getGameMatchesPromise(gameId: string): Promise<GameMatch[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games/${gameId}/matches`);
        const data: any[] = await handleJsonErrorResponse(res);
        return data.map(m => ({
            id: m.id,
            date: m.date ? new Date(m.date) : null,
            players: m.players as GameMatchPlayer[],
        }));
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function patchGamePromise(id: string, payload: { name: string }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function deleteGamePromise(id: string) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function createGamePromise(payload: { name: string }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getMePromise(): Promise<User | undefined> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/auth/me`, { method: 'GET', credentials: 'include' });
        if (res.status === 401)
            return undefined;

        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function oauth2Callback(params?: Record<string, string | string[]>): Promise<Status> {
    try {
        // Build query string from params if provided
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
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function logout(): Promise<Status> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function listUsersPromise(): Promise<User[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/users`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function patchMePromise(payload: { player_id: string | null }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/auth/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        if (res.status === 204) return;
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function patchUserPromise(userId: string, payload: { can_edit: boolean }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function createPlayerPromise(payload: { name: string }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function patchPlayerPromise(playerId: string, payload: { name: string }) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/players/${playerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function deletePlayerPromise(playerId: string) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/players/${playerId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function listClubsPromise(): Promise<Club[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getClubPromise(id: string): Promise<Club> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs/${id}`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function createClubPromise(payload: { name: string }): Promise<Club> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function patchClubPromise(id: string, payload: { name: string }): Promise<Club> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function deleteClubPromise(id: string) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function addClubMemberPromise(clubId: string, playerId: number) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs/${clubId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ player_id: playerId }),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function removeClubMemberPromise(clubId: string, playerId: number) {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/clubs/${clubId}/members/${playerId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function listAllSettingsPromise(): Promise<EloSettingEntry[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/settings/all`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function createSettingsPromise(payload: {
    effective_date: string;
    elo_const_k: number;
    elo_const_d: number;
    starting_elo: number;
    win_reward: number;
}): Promise<void> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function deleteSettingsPromise(effectiveDate: string): Promise<void> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/settings`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ effective_date: effectiveDate }),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export type SettlementDetail = {
    player_id: string;
    player_name: string;
    staked: number;
    earned: number;
};

export type MatchWinnerParams = {
    required_player_ids: string[];
    game_id: string | null;
};

export type WinStreakParams = {
    game_id: string;
    wins_required: number;
    max_losses: number | null;
};

export type Market = {
    id: string;
    market_type: 'match_winner' | 'win_streak';
    status: 'open' | 'betting_closed' | 'resolved' | 'cancelled';
    resolution_outcome?: string | null;
    starts_at: string | null;
    closes_at: string | null;
    created_at: string | null;
    resolved_at: string | null;
    betting_closed_at?: string | null;
    yes_pool: number;
    no_pool: number;
    yes_coefficient: number;
    no_coefficient: number;
    target_player_id: string;
    params: MatchWinnerParams | WinStreakParams | null;
    settlement?: SettlementDetail[];
};

export type MarketDetail = Market & {
    my_yes_staked?: number;
    my_no_staked?: number;
    projected_yes_reward?: number;
    projected_no_reward?: number;
    reserved?: number;
    bet_limit?: number;
};

export async function getMarketsPromise(): Promise<{ active: Market[]; closed: Market[] }> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets`, { credentials: 'include' });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getMarketByIdPromise(id: string): Promise<MarketDetail> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets/${id}`, { credentials: 'include' });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function createMarketPromise(payload: {
    market_type: string;
    starts_at: string | null; // null = start immediately
    closes_at: string;
    target_player_id: string;
    required_player_ids?: string[];
    game_id?: string | null;
    streak_game_id?: string | null;
    wins_required?: number | null;
    max_losses?: number | null;
}): Promise<{ id: string }> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function deleteMarketPromise(id: string): Promise<void> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (res.status === 204) return;
        await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function closeMarketBettingPromise(id: string): Promise<void> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ status: 'betting_closed' }),
        });
        await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function getMarketsByMatchIdPromise(matchId: number): Promise<Market[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/matches/${matchId}/markets`, {
            credentials: 'include',
        });
        const data = await handleJsonErrorResponse(res);
        return (data ?? []) as Market[];
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export async function placeBetPromise(marketId: string, outcome: 'yes' | 'no', amount: number): Promise<void> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/markets/${marketId}/bets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ outcome, amount }),
        });
        await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

export type RatingPoint = { date: string; rating: number };
export type GameMatchStat = { game_id: string; game_name: string; matches_count: number; wins: number };
export type GameEloStat = { game_id: string; game_name: string; elo_earned: number };
export type PlayerStats = {
    player_name: string;
    rating_history: RatingPoint[];
    top_games_by_matches: GameMatchStat[];
    top_games_by_elo_earned: GameEloStat[];
    worst_games_by_elo_earned: GameEloStat[];
};

export async function getPlayerStatsPromise(id: string): Promise<PlayerStats> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/players/${id}/stats`);
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

async function handleJsonErrorResponse(response: Response) {
    let body: any;
    try {
        body = await response.json();
    }
    catch (error) {
        if (!response.ok) {
            throw new Error(`Ошибка ${response.status}`);
        }
        throw error;
    }

    if (body.status === "fail") {
        throw new Error(body.message);
    }

    if (!response.ok) {
        throw new Error(`Ошибка ${response.status}`);
    }

    return body.data;
}

export type VoiceParseResult = {
    game_id: string | null;
    scores: { player_id: string; points: number }[];
};

export async function parseVoiceInput(text: string): Promise<VoiceParseResult> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/voice/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ text }),
        });
        return await handleJsonErrorResponse(res);
    }
    catch (error) {
        showToast(error);
        throw error;
    }
}

function showToast(error: unknown) {
    if (error instanceof Error) {
        toast.error(error.message);
    } else {
        toast.error("An unknown error occurred " + error);
    }
}
