// Shared Vitest helpers: module-mock factories and entity fixtures reused
// across the suite. Prefer these over re-declaring the same mocks per file.
//
// vi.mock factories are hoisted above the test file's imports, so reference
// these helpers via a dynamic import inside the factory:
//
//   vi.mock("@/app/api", async () => {
//       const { mockApiModule } = await import("./test-utils");
//       return mockApiModule({ getTablePromise: vi.fn() });
//   });
import { vi } from "vitest";
import type { Base58ID } from "@/lib/id";
import { GAME_ID_SKULL_KING } from "@/lib/game-apps";
import type { SkullKingGameState, TableGameState, TableSummary } from "@/app/api";

/** Cast a plain string to the branded Base58ID (test shorthand). */
export const pid = (s: string): Base58ID => s as Base58ID;

/**
 * Build the vi.mock("@/app/api") module. Every named export the code under
 * test touches becomes a cached vi.fn() automatically, so a test only lists
 * the functions it drives or asserts on; `ApiError` and `isNetworkFailure`
 * ship with working defaults (overridable).
 */
export function mockApiModule(overrides: Record<string, unknown> = {}) {
    const autoMocks = new Map<string, unknown>();
    const base: Record<string, unknown> = {
        ApiError: class ApiError extends Error {
            status?: number;
        },
        isNetworkFailure: vi.fn(() => false),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, prop) {
            // Non-string keys and `then` pass through untouched so the mock
            // module is never mistaken for a thenable.
            if (typeof prop !== "string") return Reflect.get(target, prop);
            if (prop === "then") return undefined;
            if (prop in target) return target[prop];
            if (!autoMocks.has(prop)) autoMocks.set(prop, vi.fn());
            return autoMocks.get(prop);
        },
    });
}

/** Build the vi.mock("sonner") module; import { toast } to assert on it. */
export function mockSonnerModule() {
    return { toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } };
}

/** Standard Skull King table state; override any field per scenario. */
export function makeSkullKingState(overrides: Partial<SkullKingGameState> = {}): SkullKingGameState {
    return {
        phase: "waiting-for-bids",
        players: [
            { id: pid("p1"), name: "Alice" },
            { id: pid("p2"), name: "Bob" },
        ],
        currentRound: 2,
        currentPlayerIndex: 0,
        rounds: [],
        ...overrides,
    };
}

/** Standard live-table summary for a Skull King table. */
export function makeTable(
    overrides: Partial<TableSummary> & { game_state?: TableGameState } = {},
): TableSummary {
    return {
        id: pid("t1"),
        tenant_id: pid("tenant1"),
        game_id: GAME_ID_SKULL_KING,
        host_user_id: pid("u1"),
        host_client_token: "",
        connected_player_ids: [],
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        expires_at: "2026-01-02T00:00:00Z",
        game_state: makeSkullKingState(),
        ...overrides,
    };
}
