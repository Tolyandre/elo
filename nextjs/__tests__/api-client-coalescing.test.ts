// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const { hoistedEnv } = vi.hoisted(() => {
    // client.ts throws at import when the base URL is missing; tests import
    // the module statically, so the variable must exist before that.
    process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL = "http://api.test";
    return { hoistedEnv: true };
});
void hoistedEnv;

const { coalescingFetch } = await import("@/app/api/client");

function jsonResponse(body: string, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": "application/json" } });
}

const calls: string[] = [];

afterEach(() => {
    calls.length = 0;
    vi.restoreAllMocks();
});

describe("coalescingFetch", () => {
    it("merges identical concurrent GETs into one network request, each awaiter reading the body", async () => {
        vi.stubGlobal("fetch", vi.fn(() => {
            calls.push("get");
            return Promise.resolve(jsonResponse(JSON.stringify({ n: calls.length })));
        }));

        const [a, b, c] = await Promise.all([
            coalescingFetch("http://api.test/tables?tenant=t1"),
            coalescingFetch("http://api.test/tables?tenant=t1"),
            coalescingFetch("http://api.test/tables?tenant=t1"),
        ]);
        expect(calls).toEqual(["get"]);
        // Each awaiter consumes its own readable body.
        const bodies = await Promise.all([a.json(), b.json(), c.json()]);
        expect(bodies).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    });

    it("starts a fresh request once the previous one settled (no caching)", async () => {
        vi.stubGlobal("fetch", vi.fn(() => {
            calls.push("get");
            return Promise.resolve(jsonResponse("{}"));
        }));

        await coalescingFetch("http://api.test/players");
        await coalescingFetch("http://api.test/players");
        expect(calls).toEqual(["get", "get"]);
    });

    it("does not merge different URLs or a GET carrying an abort signal", async () => {
        vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
            calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            return Promise.resolve(jsonResponse("{}"));
        }));

        const controller = new AbortController();
        await Promise.all([
            coalescingFetch("http://api.test/players"),
            coalescingFetch("http://api.test/players?tenant=t2"),
            coalescingFetch("http://api.test/ping", { signal: controller.signal }),
        ]);
        expect(calls).toHaveLength(3);
    });

    it("never merges writes, even to the same URL", async () => {
        vi.stubGlobal("fetch", vi.fn(() => {
            calls.push("post");
            return Promise.resolve(jsonResponse("{}"));
        }));

        await Promise.all([
            coalescingFetch("http://api.test/matches", { method: "POST" }),
            coalescingFetch("http://api.test/matches", { method: "POST" }),
        ]);
        expect(calls).toEqual(["post", "post"]);
    });

    it("propagates the failure to every awaiter and clears the entry", async () => {
        vi.stubGlobal("fetch", vi.fn(() => {
            calls.push("get");
            return Promise.reject(new TypeError("Failed to fetch"));
        }));

        const results = await Promise.allSettled([
            coalescingFetch("http://api.test/players"),
            coalescingFetch("http://api.test/players"),
        ]);
        expect(calls).toEqual(["get"]);
        expect(results.every((r) => r.status === "rejected")).toBe(true);

        vi.stubGlobal("fetch", vi.fn(() => {
            calls.push("get");
            return Promise.resolve(jsonResponse("{}"));
        }));
        await coalescingFetch("http://api.test/players");
        expect(calls).toEqual(["get", "get"]);
    });
});
