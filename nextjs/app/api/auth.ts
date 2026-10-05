// Auth/session endpoints and user administration. /auth/me and the OAuth2
// callback use manual fetches: 401 must resolve to undefined (cached-identity
// fallback), and the callback relays non-standard query params (ADR-29).
import { client, EloWebServiceBaseUrl, NetworkError, unwrap } from "./client";
import { toast } from "sonner";
import type { Status, User } from "./types";
import type { Base58ID } from "@/lib/id";

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
    // Manual fetch: non-standard query param assembly. The backend presents
    // the redirect_uri of the mirror named in `state` (ADR-29), so all query
    // params from Google's landing must be relayed.
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

export async function patchMePromise(payload: { player_id: Base58ID | null }) {
    await unwrap(client.PATCH("/auth/me", { body: payload }));
}

export async function listUsersPromise(): Promise<User[]> {
    return (await unwrap(client.GET("/users"))).data;
}

export async function patchUserPromise(userId: Base58ID, payload: { can_edit: boolean }) {
    return (await unwrap(client.PATCH("/users/{userId}", {
        params: { path: { userId } },
        body: payload,
    }))).data;
}
