// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Base58ID } from "@/lib/id";
import { GAME_ID_SKULL_KING, GAME_ID_IAWW } from "@/lib/game-apps";
import type { IawwGameState, SkullKingGameState, TableGameState, TableSummary } from "@/app/api";
import { TableIndicator } from "@/components/tables/table-indicator";

// Hoisted mutable state the mocks read at render time: tests mutate `me`
// and bump `tick` (the tables-lobby SSE counter) between renders.
const mocks = vi.hoisted(() => ({
    me: {
        id: undefined as string | undefined,
        playerId: undefined as Base58ID | undefined,
        isAuthenticated: false,
    },
    tick: 0,
}));

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
    listTablesPromise: vi.fn(),
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => mocks.me,
}));

vi.mock("@/hooks/useTableSSE", () => ({
    useTablesLobbySSE: () => mocks.tick,
}));

vi.mock("next/link", () => ({
    default: ({ href, title, children }: { href: string; title?: string; children?: ReactNode }) => (
        <a href={href} title={title}>{children}</a>
    ),
}));

import { listTablesPromise } from "@/app/api";

const pid = (s: string) => s as Base58ID;

function skState(players: { id: Base58ID; name: string }[]): SkullKingGameState {
    return {
        phase: "waiting-for-bids",
        players,
        currentRound: 1,
        currentPlayerIndex: 0,
        rounds: [],
    };
}

function makeTable(overrides: Partial<TableSummary> & { game_state: TableGameState }): TableSummary {
    return {
        id: pid("tableSk1"),
        game_id: GAME_ID_SKULL_KING,
        host_user_id: pid("userHost"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        ...overrides,
    };
}

/** Renders the indicator and flushes the table-list fetch. */
function renderIndicator() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<TableIndicator />);
    });
    return {
        links: () => Array.from(container.querySelectorAll("a")),
        /** Re-renders (e.g. after bumping mocks.tick) and flushes effects. */
        async rerender() {
            await act(async () => {
                root.render(<TableIndicator />);
            });
        },
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.me = { id: undefined, playerId: undefined, isAuthenticated: false };
    mocks.tick = 0;
    vi.mocked(listTablesPromise).mockResolvedValue([]);
});

describe("TableIndicator", () => {
    it("shows the icon while the player is only picked into the game (not joined)", async () => {
        mocks.me = { id: pid("userMe"), playerId: pid("playerMe"), isAuthenticated: true };
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                game_state: skState([
                    { id: pid("playerMe"), name: "Я" },
                    { id: pid("playerOther"), name: "Друг" },
                ]),
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();

        const links = view.links();
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe("/matches/table/skull-king?table=tableSk1");
        expect(links[0].getAttribute("title")).toContain("Skull King");
        view.unmount();
    });

    it("shows the icon for the host", async () => {
        mocks.me = { id: pid("userHost"), playerId: pid("playerUnrelated"), isAuthenticated: true };
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                game_state: skState([{ id: pid("playerA"), name: "А" }]),
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();
        expect(view.links()).toHaveLength(1);
        view.unmount();
    });

    it("shows the icon for a connected player who is not in the game roster", async () => {
        mocks.me = { id: pid("userMe"), playerId: pid("playerMe"), isAuthenticated: true };
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                connected_player_ids: [pid("playerMe")],
                game_state: skState([{ id: pid("playerA"), name: "А" }]),
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();
        expect(view.links()).toHaveLength(1);
        view.unmount();
    });

    it("shows nothing to an unrelated signed-in viewer", async () => {
        mocks.me = { id: pid("userMe"), playerId: pid("playerMe"), isAuthenticated: true };
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                connected_player_ids: [pid("playerOther")],
                game_state: skState([{ id: pid("playerOther"), name: "Друг" }]),
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();
        expect(view.links()).toHaveLength(0);
        view.unmount();
    });

    it("shows nothing when signed out", async () => {
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                game_state: skState([{ id: pid("playerA"), name: "А" }]),
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();
        expect(view.links()).toHaveLength(0);
        // The list is not even fetched for signed-out users.
        expect(listTablesPromise).not.toHaveBeenCalled();
        view.unmount();
    });

    it("shows one icon per table, even several of the same game", async () => {
        mocks.me = { id: pid("userMe"), playerId: pid("playerMe"), isAuthenticated: true };
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                id: pid("tableSk1"),
                game_state: skState([{ id: pid("playerMe"), name: "Я" }]),
            }),
            makeTable({
                id: pid("tableSk2"),
                game_state: skState([{ id: pid("playerMe"), name: "Я" }]),
            }),
            makeTable({
                id: pid("tableIaww1"),
                game_id: GAME_ID_IAWW,
                game_state: {
                    phase: "scoring",
                    players: [{ id: pid("playerMe"), name: "Я" }],
                    entries: [{ playerId: pid("playerMe"), directVp: null, cells: [], done: false }],
                } satisfies IawwGameState as TableGameState,
            }),
        ]);
        const view = renderIndicator();
        await view.rerender();

        const links = view.links();
        expect(links).toHaveLength(3);
        const hrefs = links.map((a) => a.getAttribute("href"));
        expect(hrefs).toContain("/matches/table/skull-king?table=tableSk1");
        expect(hrefs).toContain("/matches/table/skull-king?table=tableSk2");
        expect(hrefs).toContain("/matches/table/iaww?table=tableIaww1");
        // Same-game icons are tellable apart by their ordinal badge.
        const skLinks = links.filter((a) => a.getAttribute("href")!.includes("skull-king"));
        expect(skLinks[0].textContent).toContain("1");
        expect(skLinks[1].textContent).toContain("2");
        view.unmount();
    });

    it("a lobby tick refetches the list and reveals a new table without a reload", async () => {
        mocks.me = { id: pid("userMe"), playerId: pid("playerMe"), isAuthenticated: true };
        const view = renderIndicator();
        await view.rerender();
        expect(view.links()).toHaveLength(0);

        // The host created a table with this player: the lobby SSE bumps the
        // tick, the effect refetches, the icon appears live.
        vi.mocked(listTablesPromise).mockResolvedValue([
            makeTable({
                game_state: skState([{ id: pid("playerMe"), name: "Я" }]),
            }),
        ]);
        mocks.tick = 1;
        await view.rerender();

        expect(view.links()).toHaveLength(1);
        expect(listTablesPromise).toHaveBeenCalledTimes(2);
        view.unmount();
    });
});
