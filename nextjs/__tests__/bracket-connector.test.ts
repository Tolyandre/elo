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
    it("routes the WB→LB drop through a soft-cornered elbow", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(132, 200, 132, 150, 232, 250);
        expect(dropPath(from, to)).toBe(
            "M 100 25 L 108 25 Q 116 25 116 33 L 116 192 Q 116 200 124 200 L 132 200",
        );
    });

    it("rises through the pre-destination lane when the destination sits left of the source", () => {
        const from = anchor(132, 25, 100, 0, 132, 50);
        const to = anchor(100, 200, 0, 150, 100, 250);
        expect(dropPath(from, to)).toBe(
            "M 100 25 L 94 25 Q 88 25 88 31 L 88 194 Q 88 200 94 200 L 100 200",
        );
    });

    it("shifts the descent lane like any other connector", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(132, 200, 132, 150, 232, 250);
        expect(dropPath(from, to, 1)).toBe(
            "M 100 25 L 105 25 Q 110 25 110 30 L 110 189 Q 110 200 121 200 L 132 200",
        );
    });
});

describe("laneAssignments", () => {
    it("numbers the connectors of one destination column by their upper edge, drops included", () => {
        const top = anchor(100, 10, 0, 0, 100, 20);
        const mid = anchor(100, 20, 0, 10, 100, 30);
        const low = anchor(100, 60, 0, 50, 100, 70);
        const dest = anchor(200, 30, 200, 0, 300, 60);
        const far = anchor(400, 30, 400, 0, 500, 60);
        const lanes = laneAssignments([
            { key: "late", kind: "promotion", from: low, to: dest },
            { key: "early", kind: "promotion", from: top, to: dest },
            { key: "drop", kind: "drop", from: mid, to: dest },
            { key: "other-column", kind: "promotion", from: top, to: far },
        ]);
        expect(lanes.get("early")).toBe(0);
        expect(lanes.get("drop")).toBe(1);
        expect(lanes.get("late")).toBe(2);
        expect(lanes.get("other-column")).toBe(0);
    });
});
