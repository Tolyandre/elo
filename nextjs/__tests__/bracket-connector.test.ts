import { describe, expect, it } from "vitest";
import {
    connectorPath,
    dropPath,
    laneAssignments,
    type MeasuredAnchor,
} from "../components/bracket/bracket-connector";

function anchor(x: number, y: number, left: number, top: number, right: number, bottom: number): MeasuredAnchor {
    return { x, y, rect: { left, top, right, bottom } };
}

describe("connectorPath", () => {
    it("runs at the source's height and descends in the lane before the destination column", () => {
        // Source card [0..100], destination card starts at 200 — a long span
        // across other columns: the descent hugs the destination's gap so it
        // stays out of the cards in between.
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(200, 40, 200, 0, 300, 80);
        expect(connectorPath(from, to)).toBe(
            "M 100 25 L 178 25 Q 184 25 184 31 L 184 34 Q 184 40 190 40 L 200 40",
        );
    });

    it("shifts the descent lane per connector sharing the destination column", () => {
        // Two connectors into one column must not overlap: lane 1 sits 6px
        // left of lane 0, keeping both vertical runs visibly apart.
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(200, 40, 200, 0, 300, 80);
        expect(connectorPath(from, to, 1)).toBe(
            "M 100 25 L 172 25 Q 178 25 178 31 L 178 34 Q 178 40 184 40 L 200 40",
        );
    });

    it("clamps the descent just clear of the source card when the gap runs out", () => {
        // A tight 32px gap cannot always hold a lane left of the destination
        // column: a descent reaching past the source card's right edge would
        // tuck under the card. The floor keeps it just clear of the edge —
        // laneAssignments compresses the pitch so lanes stay distinct.
        const from = anchor(100, 40, 0, 30, 100, 50);
        const to = anchor(132, 10, 132, 0, 232, 20);
        expect(connectorPath(from, to, 5)).toBe(
            "M 100 40 L 102 40 Q 104 40 104 38 L 104 16 Q 104 10 110 10 L 132 10",
        );
    });

    it("applies a compressed lane pitch to keep every descent distinct", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(132, 40, 132, 0, 232, 80);
        // Lane 3 at 4px pitch descends at 104 — right of the source card and
        // distinct from lanes 0..2 at 116/112/108.
        expect(connectorPath(from, to, 3, 4)).toBe(
            "M 100 25 L 102 25 Q 104 25 104 27 L 104 34 Q 104 40 110 40 L 132 40",
        );
    });

    it("shrinks the corner radius for adjacent columns", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(110, 30, 110, 0, 210, 60);
        expect(connectorPath(from, to)).toBe(
            "M 100 25 L 102.5 25 Q 105 25 105 27.5 L 105 27.5 Q 105 30 107.5 30 L 110 30",
        );
    });

    it("drops into overlapping columns through the lane before the column", () => {
        // Destination's left edge sits left of the source's right edge — the
        // cards overlap, so leave the source's left edge and descend just
        // before the destination column, clear of the cards in between.
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(50, 125, 50, 100, 150, 150);
        expect(connectorPath(from, to)).toBe(
            "M 0 25 L 32 25 Q 38 25 38 31 L 38 119 Q 38 125 44 125 L 50 125",
        );
    });

    it("rises through the lane when the destination band sits above", () => {
        const from = anchor(100, 125, 0, 100, 100, 150);
        const to = anchor(50, 25, 50, 0, 150, 50);
        expect(connectorPath(from, to)).toBe(
            "M 0 125 L 32 125 Q 38 125 38 119 L 38 31 Q 38 25 44 25 L 50 25",
        );
    });

    it("keeps a straight connector when source and target rows align", () => {
        const from = anchor(100, 30, 0, 0, 100, 60);
        const to = anchor(200, 30, 200, 0, 300, 60);
        expect(connectorPath(from, to)).toBe(
            "M 100 30 L 184 30 Q 184 30 184 30 L 184 30 Q 184 30 184 30 L 200 30",
        );
    });
});

describe("dropPath", () => {
    it("hugs the source: turns down just right of it and runs at the target row's height", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(132, 200, 132, 150, 232, 250);
        expect(dropPath(from, to)).toBe(
            "M 100 25 L 104 25 Q 108 25 108 29 L 108 188 Q 108 200 120 200 L 132 200",
        );
    });

    it("rises through the pre-destination lane when the destination sits left of the source", () => {
        const from = anchor(132, 25, 100, 0, 132, 50);
        const to = anchor(100, 200, 0, 150, 100, 250);
        expect(dropPath(from, to)).toBe(
            "M 100 25 L 94 25 Q 88 25 88 31 L 88 194 Q 88 200 94 200 L 100 200",
        );
    });

    it("shifts the descent lane per drop sharing the source card", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(132, 200, 132, 150, 232, 250);
        expect(dropPath(from, to, 1)).toBe(
            "M 100 25 L 107 25 Q 114 25 114 32 L 114 191 Q 114 200 123 200 L 132 200",
        );
    });
});

describe("laneAssignments", () => {
    it("numbers the connectors of one destination column by their upper edge", () => {
        const top = anchor(100, 10, 0, 0, 100, 20);
        const low = anchor(100, 60, 0, 50, 100, 70);
        const dest = anchor(200, 30, 200, 0, 300, 60);
        const far = anchor(400, 30, 400, 0, 500, 60);
        const lanes = laneAssignments([
            { key: "late", kind: "promotion", from: low, to: dest },
            { key: "early", kind: "promotion", from: top, to: dest },
            { key: "other-column", kind: "promotion", from: top, to: far },
        ]);
        expect(lanes.get("early")).toEqual({ lane: 0, pitch: 6 });
        expect(lanes.get("late")).toEqual({ lane: 1, pitch: 6 });
        expect(lanes.get("other-column")).toEqual({ lane: 0, pitch: 6 });
    });

    it("orders same-source rising connectors so they do not cross each other", () => {
        // Mirrors the real bracket: a falling pair from the upper band and a
        // rising pair from the losers card converge on one destination
        // column through a tight gap. The rising pair's source rows decide:
        // the deeper source row (lower player) takes the shallower lane, so
        // the two lines rise as parallel neighbors instead of weaving —
        // and the compressed pitch keeps all four descents right of the
        // source card.
        const lanes = laneAssignments([
            { key: "ilja", kind: "promotion", from: anchor(48, 10, 0, 0, 48, 60), to: anchor(132, 30, 132, 0, 232, 80) },
            { key: "kolya", kind: "promotion", from: anchor(48, 20, 0, 0, 48, 60), to: anchor(132, 27, 132, 0, 232, 80) },
            { key: "pavel", kind: "promotion", from: anchor(100, 50, 40, 30, 100, 60), to: anchor(132, 26, 132, 0, 232, 80) },
            { key: "dimon", kind: "promotion", from: anchor(100, 54, 40, 30, 100, 60), to: anchor(132, 28, 132, 0, 232, 80) },
        ]);
        expect(lanes.get("ilja")).toEqual({ lane: 0, pitch: 4 });
        expect(lanes.get("kolya")).toEqual({ lane: 1, pitch: 4 });
        expect(lanes.get("dimon")).toEqual({ lane: 2, pitch: 4 });
        expect(lanes.get("pavel")).toEqual({ lane: 3, pitch: 4 });
    });

    it("swaps a same-source rising pair onto non-crossing lanes", () => {
        // Both connectors rise from one card; the upper source row belongs
        // on the deeper lane, or the two lines cross at both ends.
        const lanes = laneAssignments([
            { key: "upper", kind: "promotion", from: anchor(100, 50, 0, 30, 100, 60), to: anchor(132, 2, 132, 0, 232, 20) },
            { key: "lower", kind: "promotion", from: anchor(100, 54, 0, 30, 100, 60), to: anchor(132, 6, 132, 0, 232, 20) },
        ]);
        expect(lanes.get("upper")).toEqual({ lane: 1, pitch: 6 });
        expect(lanes.get("lower")).toEqual({ lane: 0, pitch: 6 });
    });

    it("keeps the baseline order when both orders cross equally", () => {
        // A falling pair costs one crossing either way, so the upper-edge
        // baseline survives.
        const lanes = laneAssignments([
            { key: "upper", kind: "promotion", from: anchor(100, 10, 0, 0, 100, 60), to: anchor(132, 30, 132, 0, 232, 80) },
            { key: "lower", kind: "promotion", from: anchor(100, 20, 0, 0, 100, 60), to: anchor(132, 24, 132, 0, 232, 80) },
        ]);
        expect(lanes.get("upper")).toEqual({ lane: 0, pitch: 6 });
        expect(lanes.get("lower")).toEqual({ lane: 1, pitch: 6 });
    });

    it("nests same-source falling drops so they do not cross each other", () => {
        // Two losers seats draw from one winners card: the deeper source row
        // turns first (hugging the card) and the shallower one turns outside
        // it, so the dashed lines run as parallel neighbors instead of
        // crossing at both ends.
        const lanes = laneAssignments([
            { key: "shallower", kind: "drop", from: anchor(100, 20, 0, 10, 100, 30), to: anchor(200, 50, 200, 40, 300, 100) },
            { key: "deeper", kind: "drop", from: anchor(100, 24, 0, 10, 100, 30), to: anchor(200, 54, 200, 40, 300, 100) },
        ]);
        expect(lanes.get("shallower")).toEqual({ lane: 1, pitch: 6 });
        expect(lanes.get("deeper")).toEqual({ lane: 0, pitch: 6 });
    });

    it("buckets drops by their source card, apart from the destination's promotions", () => {
        // Both drops descend hugging the same source card's right edge, so
        // they share a source bucket — independent of the promotion turning
        // before the destination column.
        const src = anchor(100, 20, 0, 10, 100, 30);
        const dest = anchor(200, 30, 200, 0, 300, 60);
        const lanes = laneAssignments([
            { key: "promo", kind: "promotion", from: anchor(100, 10, 0, 0, 100, 20), to: dest },
            { key: "drop-a", kind: "drop", from: src, to: anchor(200, 50, 200, 40, 300, 100) },
            { key: "drop-b", kind: "drop", from: src, to: anchor(200, 90, 200, 80, 300, 140) },
        ]);
        expect(lanes.get("drop-a")).toEqual({ lane: 1, pitch: 6 });
        expect(lanes.get("drop-b")).toEqual({ lane: 0, pitch: 6 });
        expect(lanes.get("promo")).toEqual({ lane: 0, pitch: 6 });
    });

    it("nests unresolved drops around their shared exit anchor", () => {
        // Unresolved drops all anchor at the card center — the same from.y —
        // so the baseline breaks the tie by target seat row; the crossing
        // search then turns the deeper target first so the shared origin
        // does not make them cross.
        const unresolved = anchor(100, 25, 0, 0, 100, 50);
        const lanes = laneAssignments([
            { key: "seat-2", kind: "drop", from: unresolved, to: anchor(200, 90, 200, 80, 300, 140) },
            { key: "seat-1", kind: "drop", from: unresolved, to: anchor(200, 50, 200, 40, 300, 100) },
        ]);
        expect(lanes.get("seat-1")).toEqual({ lane: 1, pitch: 6 });
        expect(lanes.get("seat-2")).toEqual({ lane: 0, pitch: 6 });
    });
});
