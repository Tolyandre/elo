// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import type { Base58ID } from "../lib/id";
import type { Bracket, Tournament } from "../app/api";
import { TournamentView } from "../app/tournaments/view/tournament-view";

const mocks = vi.hoisted(() => ({
    tournament: null as Tournament | null,
    games: [] as { id: Base58ID; name: string }[],
}));

vi.mock("next/link", () => ({
    // Bare jsdom has no app router; links render as plain anchors in tests.
    default: ({ href, children }: { href: string; children: ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));

vi.mock("@/app/api", () => ({
    EloWebServiceBaseUrl: "http://api.test",
    getTournamentPromise: () => Promise.resolve(mocks.tournament),
    getTournamentBracketPromise: () =>
        Promise.resolve({
            tournament_id: mocks.tournament!.id,
            status: mocks.tournament!.status,
            elimination: null,
            rounds: [],
        } satisfies Bracket),
    registerInTournamentPromise: () => Promise.resolve({}),
    unregisterFromTournamentPromise: () => Promise.resolve({}),
    getArenaPlayersPromise: () => Promise.resolve({ players: [] }),
    getArenasPromise: () => Promise.resolve({ arenas: [] }),
    parseArenaSettings: (raw: string | null) => raw,
}));

vi.mock("@/app/meContext", () => ({
    useMe: () => ({ canEdit: false, playerId: undefined }),
}));

vi.mock("@/app/players/PlayersContext", () => ({
    usePlayers: () => ({
        playerMap: new Map(),
        playerDisplayName: (p: { name: string }) => p.name,
    }),
}));

vi.mock("@/app/gamesContext", () => ({
    useGames: () => ({ games: mocks.games, invalidate: () => {} }),
}));

vi.mock("@/app/tournaments/tournamentsContext", () => ({
    useTournaments: () => ({ invalidate: () => {} }),
}));

vi.mock("@/app/pageHeaderContext", () => ({
    PageHeader: () => null,
}));

const tournament: Tournament = {
    id: "T1" as Base58ID,
    name: "Тест",
    status: "registration",
    elimination: null,
    games: [
        { game_id: "G1" as Base58ID, min_players: 2, max_players: 4 },
        { game_id: "G2" as Base58ID, min_players: 3, max_players: 5 },
        { game_id: "G9" as Base58ID, min_players: 2, max_players: 2 },
    ],
    participant_ids: [],
};

function renderView(id: string) {
    window.history.pushState({}, "", `/tournaments/view?id=${id}`);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<TournamentView />);
    });
    return {
        text: () => container.textContent ?? "",
        unmount() {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
}

async function waitForText(text: () => string, needle: string) {
    for (let i = 0; i < 50; i++) {
        if (text().includes(needle)) return;
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
    throw new Error(`text not found: ${needle}`);
}

beforeEach(() => {
    mocks.tournament = { ...tournament };
    mocks.games = [
        { id: "G1" as Base58ID, name: "Скелет короля" },
        { id: "G2" as Base58ID, name: "Инновация" },
    ];
});

describe("TournamentView game pool", () => {
    it("renders the pool with game names and table capacities", async () => {
        const view = renderView("T1");
        await waitForText(view.text, "Пул игр");
        expect(view.text()).toContain("Пул игр (вместимость столов)");
        expect(view.text()).toContain("Скелет короля");
        expect(view.text()).toContain("от 2 до 4");
        expect(view.text()).toContain("Инновация");
        expect(view.text()).toContain("от 3 до 5");
        view.unmount();
    });

    it("falls back to the raw id for a game missing from the games context", async () => {
        const view = renderView("T1");
        await waitForText(view.text, "Пул игр");
        expect(view.text()).toContain("G9");
        view.unmount();
    });

    it("renders no pool card when the pool is empty", async () => {
        mocks.tournament = { ...tournament, games: [] };
        const view = renderView("T1");
        await waitForText(view.text, "Участники");
        expect(view.text()).not.toContain("Пул игр");
        view.unmount();
    });
});
