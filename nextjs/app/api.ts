export function getPlayersPromise() {
    return fetch("https://toly.is-cool.dev/elo-web-service/players")
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

export function getPingPromise() {
    return fetch("https://toly.is-cool.dev/elo-web-service/ping",
        {
            signal: AbortSignal.timeout(3000),
        }
    );
}

export function addMatchPromise(payload: { game: string, score: Record<string, number> }) {
    return fetch("https://toly.is-cool.dev/elo-web-service/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
        .then((res) => res.json())
        .then(handleJsonErrorResponse);
}

function handleJsonErrorResponse(data: any) {
    if (data.error)
        throw new Error(data.error);

    return data;
}