import { describe, expect, it } from "vitest";
import { buildPlayerGroups } from "../lib/player-groups";
import type { Club, Player, Tournament } from "../app/api";

const player = (id: string, name: string) => ({ id, name, geologist_name: null }) as Pick<Player, "id" | "name" | "geologist_name">;
const club = (id: string, name: string, players: number[]) => ({ id, name, players, geologist_name: null }) as Club;
const tournament = (name: string, players: number[]) => ({ name, players }) as Pick<Tournament, "name" | "players">;

const name = (p: { name: string }) => p.name;

describe("buildPlayerGroups", () => {
    const players = [player("1", "Alice"), player("2", "Bob"), player("3", "Carol"), player("4", "Dave")];

    it("orders sections: recent, tournaments (alpha), clubs (mine first), no club", () => {
        const clubs = [
            club("z", "Zeta", [4]), // Dave — the current user's club
            club("a", "Alpha", [2]), // Bob — not the user's club
        ];
        const tournaments = [tournament("Beta camp", [1, 3]), tournament("Alpha camp", [2])];

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
        const groups = buildPlayerGroups(players, [], [], name, name, [tournament("Camp", [1, 3])], undefined);
        const camp = groups.find((g) => g.heading === "Camp");
        expect(camp?.options.map((o) => o.value)).toEqual(["1", "3"]);
    });

    it("omits tournament sections when none are passed", () => {
        const groups = buildPlayerGroups(players, [], [], name, name);
        expect(groups.map((g) => g.heading)).toEqual(["Без клуба"]);
    });
});
