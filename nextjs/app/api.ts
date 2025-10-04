export function getPlayersPromise() {
    return fetch("https://toly.is-cool.dev/elo-web-service/players")
        .then((res) => {
            if (!res.ok) 
                throw new Error("Failed to fetch players");
            
            const data = res.json();
            return data;
        });
}