// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// The component imports @/app/api at runtime (parseArenaSettings); client.ts
// throws at import when the base URL is missing, so it must exist first —
// static imports hoist, hence vi.hoisted.
vi.hoisted(() => {
    process.env.NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL ??= "http://api.test";
});

// ClubIcons pulls the clubs context (and the API module); the table only
// renders it, so a stub keeps the test focused.
vi.mock("@/components/player-name", () => ({
    ClubIcons: () => null,
}));

// The player links carry the current tenant (ADR-36); the stub keeps hrefs
// unscoped — link targets are not what this table's tests assert.
vi.mock("@/app/tenantScopeContext", () => ({
    useTenantScope: () => ({ playerHref: (id: string) => `/players/view?id=${id}` }),
}));

// The current user's player row is highlighted (like in the feed's match
// cards); the stub pins "who is me" without the auth machinery.
const myPlayerId = "p2";
vi.mock("@/app/meContext", () => ({
    useMe: () => ({ playerId: myPlayerId }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import type { ArenaPlayer } from "@/app/api";
import { ArenaPlayersTable } from "@/components/arena-players-table";

function player(id: string, name: string): ArenaPlayer {
    return {
        player_id: id as Base58ID,
        name,
        rating: 1000,
        league: null,
        rank: null,
        matches_count: 0,
        first_count: 0,
        second_count: 0,
        third_count: 0,
        fourth_count: 0,
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
        root.render(<ArenaPlayersTable players={players} />);
    });
    return { container, root };
}

describe("ArenaPlayersTable", () => {
    it("highlights the current user's player row", () => {
        const { container } = render([player("p1", "Аня"), player("p2", "Я")]);
        const mine = Array.from(container.querySelectorAll("td span.bg-info\\/15"));
        expect(mine).toHaveLength(1);
        expect(mine[0].textContent).toBe("Я");
    });

    it("renders other rows unhighlighted", () => {
        const { container } = render([player("p1", "Аня")]);
        expect(container.querySelectorAll("span.bg-info\\/15")).toHaveLength(0);
        expect(container.textContent).toContain("Аня");
    });
});
