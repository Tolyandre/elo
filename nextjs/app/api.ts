// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}
const BASE_API = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

export function getPlayersPromise() {
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

function handleJsonErrorResponse(data: any) {
    if (data.error) throw new Error(data.error);
    return data;
}