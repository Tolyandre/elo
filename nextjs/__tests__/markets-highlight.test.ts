import { describe, expect, it, vi } from "vitest";
import { highlightMarkets } from "@/components/markets-highlight";
import type { Market } from "@/app/api";

// The component module imports the API layer at runtime; mocking it keeps
// client.ts (and its required env var) out of the module graph. The type
// import above is erased at runtime.
vi.mock("@/app/api", () => ({ getMarketsPagePromise: vi.fn() }));

const NOW = Date.parse("2026-10-07T12:00:00Z");

function market(overrides: Omit<Partial<Market>, "id"> & { id: string }): Market {
    return {
        market_type: "match_winner",
        status: "open",
        starts_at: "2026-10-06T00:00:00Z",
        closes_at: "2026-10-08T00:00:00Z",
        created_at: "2026-10-06T00:00:00Z",
        resolved_at: null,
        liquidity_b: 0,
        outcomes: [],
        params: {},
        ...overrides,
    } as Market;
}

describe("highlightMarkets", () => {
    it("keeps every active market, open or betting-locked, in place", () => {
        const active = [
            market({ id: "open", status: "open" }),
            market({ id: "locked", status: "betting_closed", betting_closed_at: "2026-10-06T10:00:00Z" }),
        ];
        expect(highlightMarkets(active, [], NOW).map((m) => m.id)).toEqual(["open", "locked"]);
    });

    it("adds markets resolved within the last day, newest resolution order intact", () => {
        const closed = [
            market({ id: "fresh", status: "resolved", resolved_at: "2026-10-07T08:00:00Z" }),
            market({ id: "edge", status: "resolved", resolved_at: "2026-10-06T12:00:01Z" }),
        ];
        expect(highlightMarkets([], closed, NOW).map((m) => m.id)).toEqual(["fresh", "edge"]);
    });

    it("drops cancelled markets and resolutions older than a day", () => {
        const closed = [
            market({ id: "cancelled", status: "cancelled", resolved_at: "2026-10-07T10:00:00Z" }),
            market({ id: "stale", status: "resolved", resolved_at: "2026-10-06T11:59:59Z" }),
            market({ id: "no-date", status: "resolved", resolved_at: null }),
        ];
        expect(highlightMarkets([], closed, NOW)).toEqual([]);
    });

    it("lists active markets before the day's resolutions", () => {
        const result = highlightMarkets(
            [market({ id: "open" })],
            [market({ id: "resolved", status: "resolved", resolved_at: "2026-10-07T10:00:00Z" })],
            NOW,
        );
        expect(result.map((m) => m.id)).toEqual(["open", "resolved"]);
    });
});
