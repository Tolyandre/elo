// Core API plumbing: the openapi-fetch client, the response unwrapper, and
// the error types. Domain slices live in ./api/<domain>.ts; app/api.ts (the
// directory barrel) re-exports everything so import sites stay on "@/app/api".
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../api-types.gen";
import { toast } from "sonner";
import { uuidv7 } from "uuidv7";
import { encodeId, type Base58ID } from "@/lib/id";

// NEXT_PUBLIC_ prefix ensures the variable is inlined into the client bundle at build time.
if (!process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL) {
    throw new Error('Environment variable NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL is not defined');
}

export const EloWebServiceBaseUrl = process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL.replace(/\/+$/, '');

/** Mint a client-side id: a UUIDv7 encoded as a short Base58 string. */
export function newId(): Base58ID {
    return encodeId(uuidv7());
}

/**
 * Unwrap an openapi-fetch response, throwing a proper Error on failure.
 * openapi-fetch returns `{ data, error }` rather than throwing; this collapses
 * the repeated `if (error) throwApiError(error); return data.data` boilerplate.
 * Returns the success body (the full envelope); callers read `.data` etc. off it.
 * Failures throw an ApiError carrying the HTTP status when there was a response.
 */
export async function unwrap<D>(promise: Promise<{ data?: D; error?: unknown; response?: Response }>): Promise<D> {
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

// ─── In-flight GET coalescing ────────────────────────────────────────────────
// Identical concurrent GETs share one network request; every awaiter gets its
// own readable Response (a clone). A page refresh fires the same GET several
// times because React StrictMode (dev) mounts every component twice and
// independent widgets fetch the same endpoint (the tables lobby and the
// header indicator) — sharing the in-flight promise collapses them. The map
// holds a request only until it settles: no caching, nothing stale.

const inFlightGets = new Map<string, Promise<Response>>();

export function coalescingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    // Calls carrying an abort signal own their lifecycle (timeouts, unmount
    // cancellation) — never merge those; writes are not idempotent.
    if (method !== "GET" || init?.signal) {
        return fetch(input, init);
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const existing = inFlightGets.get(url);
    if (existing) {
        // Cloning is safe here: the entry exists only while the fetch is in
        // flight, and it is removed the moment the promise settles — before
        // the first caller's handlers can touch its body.
        return existing.then((res) => res.clone());
    }
    const request = fetch(input, init).finally(() => inFlightGets.delete(url));
    inFlightGets.set(url, request);
    return request;
}

export const client = createClient<paths>({
    baseUrl: EloWebServiceBaseUrl,
    credentials: "include",
    fetch: coalescingFetch,
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
