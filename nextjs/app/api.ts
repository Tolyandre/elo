// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}
const BASE_API = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

export type Player = {
    id: string;
    elo: number;
    rank: number;
    rank_day_ago: number;
    rank_week_ago: number;
};

export function getPlayersPromise(): Promise<Player[]> {
    return fetch(`${BASE_API}/players`)
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

export function getPingPromise() {
    return fetch(`${BASE_API}/ping`, {
        signal: AbortSignal.timeout(3000),
    });
}

export function getMatchesPromise() {
    return fetch(`${BASE_API}/matches`)
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

export function addMatchPromise(payload: { game: string, score: Record<string, number> }) {
    return fetch(`${BASE_API}/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

export async function getSettingsPromise(): Promise<{
    elo_const_k: string,
    elo_const_d: string
}> {
    const res = await fetch(`${BASE_API}/settings`);
    const data = await res.json();
    return handleJsonErrorResponse(data);
}

export async function getGamesPromise(): Promise<{
    games: {
        id: string,
        last_played_order: number
    }[]
}> {
    const res = await fetch(`${BASE_API}/games`);
    const data = await res.json();
    return handleJsonErrorResponse(data);
}

export type Game = {
    id: string;
    total_matches: number;
};

export async function getGamePromise(id: string): Promise<Game> {
    const res = await fetch(`${BASE_API}/games/${id}`);
    const data = await res.json();
    return handleJsonErrorResponse(data);
}

export function deleteCache(): Promise<any> {
    return fetch(`${BASE_API}/cache`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    })
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

function handleJsonErrorResponse(data: any) {
    if (data.error) throw new Error(data.error);
    return data;
}