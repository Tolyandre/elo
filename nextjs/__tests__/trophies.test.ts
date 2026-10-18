import { describe, expect, it, vi, afterEach } from "vitest";
import { availableTrophies, takenTrophyKeys, trophyById, trophySrc } from "../lib/trophies";
import { IMAGE_POOLS } from "../lib/image-pools.gen";
import type { Tournament } from "../app/api";

const tournament = (id: string, trophy?: string) =>
    ({ id, trophy }) as unknown as Tournament;

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("trophy pool manifest", () => {
    it("mirrors the public/trophies folder, keys are file names without extension", () => {
        for (const fileName of IMAGE_POOLS.trophies) {
            const key = fileName.replace(/\.[a-z0-9]+$/i, "");
            expect(trophyById(key)?.fileName).toBe(fileName);
        }
        expect(trophyById("no-such-trophy")).toBeUndefined();
    });

    it("the innovation trophy keeps its token across the png → svg swap", () => {
        // Tournaments in the DB hold the token "innovation"; the swap only
        // changed the file extension, so the key must keep resolving.
        expect(trophyById("innovation")?.fileName).toBe("innovation.svg");
    });

    it("trophySrc serves images under the static-export basePath", () => {
        const trophy = trophyById("seti");
        expect(trophy).toBeDefined();
        vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
        expect(trophySrc(trophy!)).toBe(`/trophies/${trophy!.fileName}`);
        vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/elo");
        expect(trophySrc(trophy!)).toBe(`/elo/trophies/${trophy!.fileName}`);
    });
});

describe("takenTrophyKeys", () => {
    it("collects assigned trophies, skipping tournaments without one", () => {
        const tournaments = [tournament("t0"), tournament("t1", "serpent-hunt"), tournament("t2", "seti")];
        expect(takenTrophyKeys(tournaments)).toEqual(new Set(["serpent-hunt", "seti"]));
    });

    it("ignores the holder itself, so its own pick stays selectable", () => {
        const tournaments = [tournament("t1", "serpent-hunt"), tournament("t2", "seti")];
        expect(takenTrophyKeys(tournaments, "t1")).toEqual(new Set(["seti"]));
    });
});

describe("availableTrophies", () => {
    it("hides trophies held by other tournaments but not the holder's own pick", () => {
        const tournaments = [tournament("t1", "serpent-hunt")];
        const available = availableTrophies(tournaments, undefined).map((t) => t.key);
        expect(available).toHaveLength(IMAGE_POOLS.trophies.length - 1);
        expect(available).not.toContain("serpent-hunt");

        const withOwn = availableTrophies(tournaments, "t1").map((t) => t.key);
        expect(withOwn).toHaveLength(IMAGE_POOLS.trophies.length);
        expect(withOwn).toContain("serpent-hunt");
    });
});
