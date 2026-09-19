import { describe, expect, it } from "vitest";
import { connectorPath, type MeasuredAnchor } from "../components/bracket/bracket-connector";

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
