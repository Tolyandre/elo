// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { currentFrontendUri, loginUrl } from "@/lib/login-url";

vi.mock("@/app/api", () => ({ EloWebServiceBaseUrl: "http://api.test" }));

beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
});

describe("login-url helpers", () => {
    it("currentFrontendUri is the origin plus the baked basePath", () => {
        process.env.NEXT_PUBLIC_BASE_PATH = "/elo";
        expect(currentFrontendUri()).toBe(`${window.location.origin}/elo`);
    });

    it("currentFrontendUri has no trailing slash without a basePath", () => {
        expect(currentFrontendUri()).toBe(window.location.origin);
    });

    it("loginUrl carries the current mirror as the encoded from parameter", () => {
        process.env.NEXT_PUBLIC_BASE_PATH = "/elo-stage";
        expect(loginUrl()).toBe(
            `http://api.test/auth/login?from=${encodeURIComponent(`${window.location.origin}/elo-stage`)}`,
        );
    });
});
