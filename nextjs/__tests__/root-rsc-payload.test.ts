// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installRootRscPayloadRewrite, rewriteRootRscPayloadUrl } from "@/lib/root-rsc-payload";
import { precacheUrlToFile, precacheUrlsForRoute, urlWithinBasePath } from "@/lib/offline/precache-urls";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("rewriteRootRscPayloadUrl", () => {
    it("rewrites the router's root payload request, preserving the query", () => {
        const rewritten = rewriteRootRscPayloadUrl(new URL("http://x.test/elo.txt?_rsc=abc"), "/elo");
        expect(String(rewritten)).toBe("http://x.test/elo/index.txt?_rsc=abc");
    });

    it("leaves every other URL alone", () => {
        const untouched = [
            "http://x.test/elo/help.txt",
            "http://x.test/elo/help",
            "http://x.test/help.txt",
            "http://x.test/other/elo.txt",
            "http://x.test/elo",
        ];
        for (const href of untouched) {
            expect(rewriteRootRscPayloadUrl(new URL(href), "/elo")).toBeNull();
        }
    });

    it("does nothing without a basePath", () => {
        expect(rewriteRootRscPayloadUrl(new URL("http://x.test/elo.txt"), "")).toBeNull();
        expect(rewriteRootRscPayloadUrl(new URL("http://x.test/index.txt"), "/")).toBeNull();
    });
});

describe("precacheUrlsForRoute", () => {
    it("covers the root under both html spellings plus the index.txt payload", () => {
        expect(precacheUrlsForRoute("/", "/elo")).toEqual(["/elo", "/elo/", "/elo/index.txt"]);
        expect(precacheUrlsForRoute("/", "")).toEqual(["/", "/index.txt"]);
    });

    it("covers nested routes as extensionless html plus the .txt payload", () => {
        expect(precacheUrlsForRoute("/help", "/elo")).toEqual(["/elo/help", "/elo/help.txt"]);
        expect(precacheUrlsForRoute("/help", "")).toEqual(["/help", "/help.txt"]);
    });
});

describe("urlWithinBasePath", () => {
    it("accepts URLs inside the deploy root at segment boundaries", () => {
        expect(urlWithinBasePath("/elo", "/elo")).toBe(true);
        expect(urlWithinBasePath("/elo/", "/elo")).toBe(true);
        expect(urlWithinBasePath("/elo/index.txt", "/elo")).toBe(true);
        expect(urlWithinBasePath("/anything", "")).toBe(true);
    });

    it("rejects URLs outside the deploy root even when the string prefixes them", () => {
        expect(urlWithinBasePath("/elo.txt", "/elo")).toBe(false);
        expect(urlWithinBasePath("/elophone", "/elo")).toBe(false);
    });
});

describe("precacheUrlToFile", () => {
    it("maps served URLs to exported files", () => {
        expect(precacheUrlToFile("/elo", "/elo")).toBe("index.html");
        expect(precacheUrlToFile("/elo/", "/elo")).toBe("index.html");
        expect(precacheUrlToFile("/elo/index.txt", "/elo")).toBe("index.txt");
        expect(precacheUrlToFile("/elo/help", "/elo")).toBe("help.html");
        expect(precacheUrlToFile("/elo/help.txt", "/elo")).toBe("help.txt");
        expect(precacheUrlToFile("/", "")).toBe("index.html");
        expect(precacheUrlToFile("/help", "")).toBe("help.html");
        expect(precacheUrlToFile("/help.txt", "")).toBe("help.txt");
    });
});

describe("installRootRscPayloadRewrite", () => {
    const delegate = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
        Promise.resolve({ ok: true } as Response),
    );
    const setFetch = () => {
        window.fetch = delegate as unknown as typeof window.fetch;
    };

    it("does nothing without a basePath", () => {
        setFetch();
        vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
        installRootRscPayloadRewrite();
        expect(window.fetch).toBe(delegate);
    });

    it("rewrites only the root payload request and installs exactly once", async () => {
        setFetch();
        vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/elo");

        installRootRscPayloadRewrite();
        const wrapped = window.fetch;
        installRootRscPayloadRewrite();
        expect(window.fetch).toBe(wrapped);

        await wrapped("/elo.txt?_rsc=abc");
        const [rewritten, init] = delegate.mock.lastCall!;
        expect(String(rewritten)).toBe("http://localhost:3000/elo/index.txt?_rsc=abc");
        expect(init).toBeUndefined();

        await wrapped("/elo/help.txt");
        expect(delegate.mock.lastCall![0]).toBe("/elo/help.txt");

        await wrapped("https://else.example/elo.txt");
        expect(delegate.mock.lastCall![0]).toBe("https://else.example/elo.txt");
    });
});
