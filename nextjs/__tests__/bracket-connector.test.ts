import { describe, expect, it } from "vitest";
import { connectorPath, type MeasuredAnchor } from "../components/bracket/bracket-connector";

function anchor(x: number, y: number, left: number, top: number, right: number, bottom: number): MeasuredAnchor {
    return { x, y, rect: { left, top, right, bottom } };
}

describe("connectorPath", () => {
    it("draws a right-angle elbow between side-by-side cards, turning in the column gap", () => {
        // Source card [0..100], destination card starts at 200 — a round gap
        // with its midpoint at x=150.
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(200, 40, 200, 0, 300, 80);
        expect(connectorPath(from, to)).toBe(
            "M 100 25 L 144 25 Q 150 25 150 31 L 150 34 Q 150 40 156 40 L 200 40",
        );
    });

    it("shrinks the corner radius for adjacent columns", () => {
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(110, 30, 110, 0, 210, 60);
        expect(connectorPath(from, to)).toBe(
            "M 100 25 L 102.5 25 Q 105 25 105 27.5 L 105 27.5 Q 105 30 107.5 30 L 110 30",
        );
    });

    it("drops a right-angle connector between stacked bands (WB → LB)", () => {
        // Destination's left edge sits left of the source's right edge — the
        // cards are not side-by-side, so leave the source's bottom edge.
        const from = anchor(100, 25, 0, 0, 100, 50);
        const to = anchor(50, 125, 50, 100, 150, 150);
        expect(connectorPath(from, to)).toBe(
            "M 50 50 L 50 69 Q 50 75 56 75 L 94 75 Q 100 75 100 81 L 100 100",
        );
    });

    it("rises vertically when the destination band sits above", () => {
        const from = anchor(100, 125, 0, 100, 100, 150);
        const to = anchor(50, 25, 50, 0, 150, 50);
        expect(connectorPath(from, to)).toBe(
            "M 50 100 L 50 81 Q 50 75 56 75 L 94 75 Q 100 75 100 69 L 100 50",
        );
    });

    it("keeps a straight connector when source and target rows align", () => {
        const from = anchor(100, 30, 0, 0, 100, 60);
        const to = anchor(200, 30, 200, 0, 300, 60);
        expect(connectorPath(from, to)).toBe(
            "M 100 30 L 150 30 Q 150 30 150 30 L 150 30 Q 150 30 150 30 L 200 30",
        );
    });
});
