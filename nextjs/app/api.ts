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
}

export type Status = {
    status: "success" | "fail";
    error?: string;
}

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
};

export type PlayerScore = {
    eloPay: number;
    eloEarn: number;
    score: number;
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

export async function getMatchesPromise(): Promise<Match[]> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/matches`);
        const matches: any[] = await handleJsonErrorResponse(res);
        return matches.map(m => {
            return {
                id: m.id,
                game_id: m.game_id,
                game_name: m.game_name,
                score: m.score,
                date: m.date ? new Date(m.date) : null
            }
        });
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

export async function getSettingsPromise(): Promise<{
    elo_const_k: string,
    elo_const_d: string,
    google_sheet_link: string,
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

export async function deleteCache(): Promise<any> {
    try {
        const res = await fetch(`${EloWebServiceBaseUrl}/cache`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
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

function showToast(error: unknown) {
    if (error instanceof Error) {
        toast.error(error.message);
    } else {
        toast.error("An unknown error occurred " + error);
    }
}
