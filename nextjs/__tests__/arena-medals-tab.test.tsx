// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// ClubIcons pulls the clubs context (and the API module); the medals table
// only renders it, so a stub keeps the test focused.
vi.mock("@/components/player-name", () => ({
    ClubIcons: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import type { ArenaPlayer } from "@/app/api";
import { ArenaMedalsTab } from "@/app/arenas/view/arena-medals-tab";

function player(
    id: string,
    counts: [number, number, number, number],
    matches = counts[0] + counts[1] + counts[2] + counts[3],
): ArenaPlayer {
    return {
        player_id: id as Base58ID,
        name: id,
        rating: 1000,
        league: null,
        rank: null,
        matches_count: matches,
        first_count: counts[0],
        second_count: counts[1],
        third_count: counts[2],
        fourth_count: counts[3],
        matches_left_for_elite: 0,
        wins_needed_for_amateur: 0,
        wins_needed_for_amateur_upper: 0,
    };
}

function render(players: ArenaPlayer[]) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<ArenaMedalsTab players={players} loading={false} />);
    });
    const text = () => container.textContent ?? "";
    const rows = () => Array.from(container.querySelectorAll("tbody tr"));
    return {
        text,
        rows,
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

describe("ArenaMedalsTab", () => {
    it("shows the empty state without matches", () => {
        const view = render([]);
        expect(view.text()).toContain("Нет партий");
        view.unmount();
    });

    it("orders players by medals (gold, then silver, …) then matches", () => {
        const view = render([
            player("Bob", [1, 0, 0, 0]),
            player("Carol", [1, 1, 0, 0]),
            player("Alice", [0, 0, 0, 0], 5),
        ]);
        const names = view.rows().map((r) => r.querySelector("td")?.textContent);
        expect(names).toEqual(["Carol", "Bob", "Alice"]);
        view.unmount();
    });

    it("breaks medal ties by total matches", () => {
        const view = render([
            player("Lazy", [1, 0, 0, 0], 1),
            player("Busy", [1, 0, 0, 0], 7),
        ]);
        const names = view.rows().map((r) => r.querySelector("td")?.textContent);
        expect(names).toEqual(["Busy", "Lazy"]);
        view.unmount();
    });
});
