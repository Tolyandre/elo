// Field-level three-way merge for offline edit ops (ADR-37): the optimistic
// lock at field granularity — a user's value applies only if they observed
// the value it overwrites.
import { describe, expect, it } from "vitest";

import { applyResolutions, mergeFields } from "../lib/offline/merge";

const identity = (field: string) => `поле ${field}`;

describe("mergeFields", () => {
    it("applies user changes when the server still holds the base", () => {
        const { merged, conflicts } = mergeFields(
            { base: { name: "A" }, patch: { name: "B" }, server: { name: "A" } },
            identity,
        );
        expect(merged).toEqual({ name: "B" });
        expect(conflicts).toHaveLength(0);
    });

    it("takes the server value for fields the user did not touch", () => {
        const { merged, conflicts } = mergeFields(
            { base: { name: "A" }, patch: { name: "A" }, server: { name: "C" } },
            identity,
        );
        expect(merged).toEqual({ name: "C" });
        expect(conflicts).toHaveLength(0);
    });

    it("reports a conflict when both sides changed the same field differently", () => {
        const { merged, conflicts } = mergeFields(
            { base: { name: "A" }, patch: { name: "B" }, server: { name: "C" } },
            identity,
        );
        expect(merged.name).toBe("B"); // held for display until resolved
        expect(conflicts).toEqual([{ field: "name", label: "поле name", ours: "B", theirs: "C" }]);
    });

    it("treats map fields as one unit — per-key splitting is the caller's job (mergeMatchOp)", () => {
        // User changed the map, server still holds the base → apply the user's map.
        const applied = mergeFields(
            {
                base: { score: { p1: 10, p2: 20 } },
                patch: { score: { p1: 15, p2: 20 } },
                server: { score: { p1: 10, p2: 20 } },
            },
            identity,
        );
        expect(applied.merged.score).toEqual({ p1: 15, p2: 20 });
        expect(applied.conflicts).toHaveLength(0);

        // Both changed → one whole-field conflict (mergeMatchOp flattens the
        // map first, so production conflicts carry score:<key> fields).
        const raced = mergeFields(
            { base: { score: { p1: 10 } }, patch: { score: { p1: 15 } }, server: { score: { p1: 12 } } },
            identity,
        );
        expect(raced.conflicts).toHaveLength(1);
        expect(raced.conflicts[0].ours).toBe('{"p1":15}');
        expect(raced.conflicts[0].theirs).toBe('{"p1":12}');
    });

    it("compares objects key-order-insensitively", () => {
        const { conflicts } = mergeFields(
            { base: { score: { p1: 10, p2: 20 } }, patch: { score: { p2: 20, p1: 10 } }, server: { score: { p2: 20, p1: 10 } } },
            identity,
        );
        expect(conflicts).toHaveLength(0);
    });
});

describe("applyResolutions", () => {
    it("moves the chosen value into the patch and the server value into the base", () => {
        const { base, patch } = applyResolutions(
            { name: "A" },
            { name: "B" },
            [{ field: "name", label: "Имя", ours: "B", theirs: "C" }],
            { name: "C" },
        );
        // Take-theirs: patch == base == server → the next merge is a no-op.
        expect(patch).toEqual({ name: "C" });
        expect(base).toEqual({ name: "C" });
    });

    it("keep-mine re-arms the patch against the server's last-known value", () => {
        const { base, patch } = applyResolutions(
            { name: "A" },
            { name: "B" },
            [{ field: "name", label: "Имя", ours: "B", theirs: "C" }],
            { name: "B" },
        );
        // patch "B" ≠ base "C" (the server now holds C) → the next merge
        // applies the user's value over the fresh base.
        expect(patch).toEqual({ name: "B" });
        expect(base).toEqual({ name: "C" });
    });
});
