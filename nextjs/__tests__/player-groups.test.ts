import { describe, expect, it } from "vitest";
import { buildPlayerGroups, buildPlayerTabs, recentCoPlayerIds } from "../lib/player-groups";
import type { Club, Match, Player, Tournament } from "../app/api";

const player = (id: string, name: string) => ({ id, name, geologist_name: null }) as Pick<Player, "id" | "name" | "geologist_name">;
const club = (id: string, name: string, players: string[]) => ({ id, name, players, geologist_name: null }) as Club;
const tournament = (name: string, players: string[]) => ({ name, players }) as Pick<Tournament, "name" | "players">;

const name = (p: { name: string }) => p.name;

describe("buildPlayerGroups", () => {
    const players = [player("1", "Alice"), player("2", "Bob"), player("3", "Carol"), player("4", "Dave")];

    it("orders sections: recent, tournaments (alpha), clubs (mine first), no club", () => {
        const clubs = [
            club("z", "Zeta", ["4"]), // Dave — the current user's club
            club("a", "Alpha", ["2"]), // Bob — not the user's club
        ];
        const tournaments = [tournament("Beta camp", ["1", "3"]), tournament("Alpha camp", ["2"])];

        const groups = buildPlayerGroups(players, clubs, ["1"], name, name, tournaments, "4");

        expect(groups.map((g) => g.heading)).toEqual([
            "Недавние",
            "Alpha camp",
            "Beta camp",
            "Zeta", // current user's club first, despite "Alpha" < "Zeta" alphabetically
            "Alpha",
            "Без клуба",
        ]);
    });

    it("includes a tournament's participants in its section", () => {
        const groups = buildPlayerGroups(players, [], [], name, name, [tournament("Camp", ["1", "3"])], undefined);
        const camp = groups.find((g) => g.heading === "Camp");
        expect(camp?.options.map((o) => o.value)).toEqual(["1", "3"]);
    });

    it("omits tournament sections when none are passed", () => {
        const groups = buildPlayerGroups(players, [], [], name, name);
        expect(groups.map((g) => g.heading)).toEqual(["Без клуба"]);
    });
});

const match = (date: string, ids: string[]) =>
    ({ date, score: Object.fromEntries(ids.map((id) => [id, {}])) }) as unknown as Pick<Match, "date" | "score">;

describe("recentCoPlayerIds", () => {
    it("returns self first, then distinct co-players of newest shared matches", () => {
        const matches = [
            match("2024-01-03", ["me", "1", "2"]),
            match("2024-01-02", ["me", "2", "3"]),
            match("2024-01-01", ["x", "y"]), // not mine — ignored
        ];
        expect(recentCoPlayerIds(matches, "me")).toEqual(["me", "1", "2", "3"]);
    });

    it("includes self even when their matches are solo", () => {
        expect(recentCoPlayerIds([match("2024-01-01", ["me"])], "me")).toEqual(["me"]);
    });

    it("respects the co-player limit and orders by match recency", () => {
        const matches = [
            match("2024-01-04", ["me", "5"]),
            match("2024-01-03", ["me", "6"]),
            match("2024-01-02", ["me", "7"]),
            match("2024-01-01", ["me", "8"]),
        ];
        expect(recentCoPlayerIds(matches, "me", 3)).toEqual(["me", "5", "6", "7"]);
    });

    it("is empty without a current player", () => {
        expect(recentCoPlayerIds([match("2024-01-01", ["a", "b"])], undefined)).toEqual([]);
    });

    it("is empty when the current player has no matches", () => {
        expect(recentCoPlayerIds([match("2024-01-01", ["a", "b"])], "me")).toEqual([]);
    });
});

describe("buildPlayerTabs", () => {
    const players = [player("1", "Alice"), player("2", "Bob"), player("3", "Carol"), player("4", "Dave")];

    it("orders tabs: recent, tournaments, my clubs, then Другие", () => {
        const clubs = [
            club("z", "Zeta", ["4"]), // Dave — the current user's club
            club("a", "Alpha", ["2"]), // Bob — other club
        ];
        const tournaments = [tournament("Camp", ["1", "3"])] as Pick<Tournament, "id" | "name" | "players">[];
        const tabs = buildPlayerTabs(players, clubs, ["1"], name, name, "4", tournaments);

        expect(tabs.map((t) => t.label)).toEqual(["Недавние", "Camp", "Zeta", "Другие"]);
        // "Другие" holds a section for the other club and the club-less players
        const other = tabs.find((t) => t.label === "Другие")!;
        expect(other.sections.map((s) => s.heading)).toEqual(["Alpha", "Без клуба"]);
        // The club tab carries its club for icon rendering
        expect(tabs.find((t) => t.label === "Zeta")!.club?.id).toBe("z");
    });

    it("omits the recent tab when there are no recent ids", () => {
        const tabs = buildPlayerTabs(players, [], [], name, name, undefined);
        expect(tabs.map((t) => t.label)).toEqual(["Другие"]);
    });
});
