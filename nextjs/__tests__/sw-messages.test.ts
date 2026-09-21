import { describe, expect, it } from "vitest";
import { parseSwMessage } from "@/lib/sw-messages";

describe("parseSwMessage", () => {
    it("parses a precache progress message", () => {
        expect(parseSwMessage({ type: "sw-precache-progress", done: 42, total: 200 })).toEqual({
            type: "sw-precache-progress",
            done: 42,
            total: 200,
        });
    });

    it("parses both api visibility messages", () => {
        expect(parseSwMessage({ type: "api-served-from-cache", url: "http://api/players" })).toEqual({
            type: "api-served-from-cache",
            url: "http://api/players",
        });
        expect(parseSwMessage({ type: "api-network-ok", url: "http://api/games" })).toEqual({
            type: "api-network-ok",
            url: "http://api/games",
        });
    });

    it("rejects malformed payloads", () => {
        expect(parseSwMessage(null)).toBeNull();
        expect(parseSwMessage("hello")).toBeNull();
        expect(parseSwMessage({ type: "sw-precache-progress", done: "1", total: 2 })).toBeNull();
        expect(parseSwMessage({ type: "sw-precache-progress", total: 2 })).toBeNull();
        expect(parseSwMessage({ type: "api-network-ok" })).toBeNull();
        expect(parseSwMessage({ type: "something-else", url: "x" })).toBeNull();
    });
});
