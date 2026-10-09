// Raw-fetch error handling: the manual fetch sites must turn an empty or
// non-JSON error body (a crashed server's bare 500) into a status message
// instead of Response.json()'s "Unexpected end of JSON input".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
    // client.ts throws at import time without a base URL.
    process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ??= "http://api.test";
});

vi.mock("sonner", () => ({
    toast: { error: vi.fn() },
}));

import { parseJsonBody } from "@/app/api/client";
import { getArenaSafePromise } from "@/app/api/arenas";
import { getMePromise } from "@/app/api/auth";
import { toBase58ID } from "@/lib/id";

function jsonResponse(status: number, body: string | null): Response {
    return new Response(body, {
        status,
        headers: body === null ? {} : { "content-type": "application/json" },
    });
}

describe("parseJsonBody", () => {
    it("returns null for an empty body", async () => {
        expect(await parseJsonBody(jsonResponse(500, null))).toBeNull();
    });

    it("returns null for a non-JSON body", async () => {
        const res = new Response("<html>oops</html>", { status: 502 });
        expect(await parseJsonBody(res)).toBeNull();
    });

    it("parses a valid JSON body", async () => {
        expect(await parseJsonBody(jsonResponse(200, '{"status":"ok"}'))).toEqual({ status: "ok" });
    });
});

describe("getArenaSafePromise", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const id = toBase58ID("M7og81H92UBUBDjgu5ih36")!;

    it("returns null on 404", async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(404, null));
        expect(await getArenaSafePromise(id)).toBeNull();
    });

    it("throws the status message on a 500 with an empty body", async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(500, null));
        await expect(getArenaSafePromise(id)).rejects.toThrow("Ошибка 500");
    });

    it("throws the server message on a fail envelope", async () => {
        vi.mocked(fetch).mockResolvedValue(
            jsonResponse(500, JSON.stringify({ status: "fail", message: "panic: index out of range" })),
        );
        await expect(getArenaSafePromise(id)).rejects.toThrow("panic: index out of range");
    });

    it("returns the arena on success", async () => {
        const arena = { id: id, name: "Синие люди" };
        vi.mocked(fetch).mockResolvedValue(jsonResponse(200, JSON.stringify({ status: "success", data: arena })));
        expect(await getArenaSafePromise(id)).toEqual(arena);
    });
});

describe("getMePromise", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns undefined on 401", async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(401, null));
        expect(await getMePromise()).toBeUndefined();
    });

    it("throws the status message on a 500 with an empty body", async () => {
        vi.mocked(fetch).mockResolvedValue(jsonResponse(500, null));
        await expect(getMePromise()).rejects.toThrow("Ошибка 500");
    });
});
