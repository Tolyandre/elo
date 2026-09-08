// Per-device token for live-table hosting claims (ADR-18). Hosting belongs
// to one device at a time: the table stores the token of the device that
// last claimed it (create, resume, takeover), and a host session whose token
// no longer matches steps down to player/viewer mode. The token is minted
// once per browser and persisted; SSR and private-mode failures fall back to
// an empty token, which simply disables the client-side check.

const KEY = "game-table/client-token";

export function getTableClientToken(): string {
    try {
        const existing = localStorage.getItem(KEY);
        if (existing) return existing;
        const token = crypto.randomUUID();
        localStorage.setItem(KEY, token);
        return token;
    } catch {
        return "";
    }
}
