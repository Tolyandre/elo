// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Base58ID } from "../lib/id";
import type { CampArena } from "../app/arenas/campsContext";
import { renderHook } from "./render-hook";

// useCampSelection reads the preloaded camp list from the CampsProvider
// context; the test pins the list directly.
const camps: CampArena[] = [
    {
        id: "camp-open" as Base58ID,
        name: "Открытый кэмп",
        starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T23:59:00Z",
        player_ids: ["p1", "p2"] as Base58ID[],
    },
    {
        id: "camp-second" as Base58ID,
        name: "Второй июньский кэмп",
        starts_at: "2026-06-10T00:00:00Z",
        ends_at: "2026-06-20T00:00:00Z",
        player_ids: [] as Base58ID[],
    },
    {
        id: "camp-past" as Base58ID,
        name: "Прошедший кэмп",
        starts_at: "2026-01-01T00:00:00Z",
        ends_at: "2026-01-10T00:00:00Z",
        player_ids: ["p1"] as Base58ID[],
    },
];

vi.mock("@/app/arenas/campsContext", () => ({
    useCamps: () => ({
        camps,
        activeCamps: (date: Date = new Date()) => {
            const t = date.getTime();
            return camps.filter(
                (c) => new Date(c.starts_at).getTime() <= t && t <= new Date(c.ends_at).getTime(),
            );
        },
        invalidate: () => {},
    }),
}));

const { useCampSelection } = await import("../hooks/useCampSelection");

const june15 = new Date("2026-06-15T12:00:00Z");
const p = (id: string) => id as Base58ID;

describe("useCampSelection", () => {
    it("shows only camps whose window contains the date", () => {
        const { current } = renderHook(() => useCampSelection([], june15));
        expect(current.value.active.map((c) => c.id).sort()).toEqual(["camp-open", "camp-second"]);
    });

    it("default-checks a camp when any selected player participates", () => {
        const { current } = renderHook(() => useCampSelection([p("p3"), p("p1")], june15));
        // p1 has a settlement in the camp; p3 does not — one is enough.
        expect(current.value.checked).toEqual(["camp-open"]);
    });

    it("does not default-check when no participant plays in the camp", () => {
        const { current } = renderHook(() => useCampSelection([p("p3")], june15));
        expect(current.value.checked).toEqual([]);
    });

    it("an explicit toggle wins over the participation default", () => {
        let overrides: Partial<Record<string, boolean>> = {};
        const setOverrides = (
            updater: (prev: Partial<Record<string, boolean>>) => Partial<Record<string, boolean>>,
        ) => {
            overrides = updater(overrides);
        };
        const first = renderHook(() =>
            useCampSelection([p("p1")], june15, { overrides, setOverrides }),
        );
        expect(first.current.value.checked).toEqual(["camp-open"]);
        // The default-checked camp is unchecked by hand.
        first.current.value.toggle("camp-open" as Base58ID, false);
        const second = renderHook(() =>
            useCampSelection([p("p1")], june15, { overrides, setOverrides }),
        );
        expect(second.current.value.checked).toEqual([]);
    });

    it("on edit the base set is the match's camps, not the participation rule", () => {
        const { current } = renderHook(() =>
            useCampSelection([], june15, { selectedIds: [p("camp-open")] }),
        );
        expect(current.value.checked).toEqual(["camp-open"]);
        // A selected camp whose window no longer contains the edited date
        // stays visible and checked (saving fails server-side unless unticked).
        const { current: staleWindow } = renderHook(() =>
            useCampSelection([], new Date("2026-08-01T12:00:00Z"), {
                selectedIds: [p("camp-open")],
            }),
        );
        expect(staleWindow.value.active.map((c) => c.id)).toEqual(["camp-open"]);
        expect(staleWindow.value.checked).toEqual(["camp-open"]);
    });

    it("on edit a toggle overrides the match's camps", () => {
        let overrides: Partial<Record<string, boolean>> = {};
        const setOverrides = (
            updater: (prev: Partial<Record<string, boolean>>) => Partial<Record<string, boolean>>,
        ) => {
            overrides = updater(overrides);
        };
        const first = renderHook(() =>
            useCampSelection([], june15, {
                selectedIds: [p("camp-open")],
                overrides,
                setOverrides,
            }),
        );
        // Untick the match's camp and tick another active one — the fix-up
        // flow. Updater-based toggles compose without a re-render in between.
        first.current.value.toggle("camp-open" as Base58ID, false);
        first.current.value.toggle("camp-second" as Base58ID, true);
        const second = renderHook(() =>
            useCampSelection([], june15, {
                selectedIds: [p("camp-open")],
                overrides,
                setOverrides,
            }),
        );
        expect(second.current.value.idsToSubmit()).toEqual(["camp-second"]);
    });

    it("idsToSubmit intersects the checked set with the active camps on create", () => {
        const { current } = renderHook(() =>
            useCampSelection([p("p1")], june15, {
                overrides: { "camp-past": true },
            }),
        );
        // camp-past is checked but not active on the date — not submitted.
        expect(current.value.idsToSubmit()).toEqual(["camp-open"]);
    });
});
