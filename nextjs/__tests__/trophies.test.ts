import { describe, expect, it } from "vitest";
import { availableTrophies, takenTrophyKeys, trophyById } from "../lib/trophies";
import { IMAGE_POOLS } from "../lib/image-pools.gen";
import type { Tournament } from "../app/api";

const tournament = (id: string, trophy?: string) =>
    ({ id, trophy }) as unknown as Tournament;

describe("trophy pool manifest", () => {
    it("mirrors the public/trophies folder, keys are file names without extension", () => {
        for (const fileName of IMAGE_POOLS.trophies) {
            const key = fileName.replace(/\.[a-z0-9]+$/i, "");
            expect(trophyById(key)?.src).toBe(`/trophies/${fileName}`);
        }
        expect(trophyById("no-such-trophy")).toBeUndefined();
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
