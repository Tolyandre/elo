"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

// Client components are also server-rendered; only measure on the client.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Promotion-line machinery shared by the live bracket view and the plan
 * preview (ADR-26 §UI). Renderers mark slot cards, seat rows and standings
 * rows with data attributes; the hook measures them and turns connector
 * specs into SVG bezier paths over the shared scroll content.
 */

export interface ConnectorAnchorSpec {
    /** Slot card marked with `data-bracket-slot`. */
    slotId: string;
    /** Anchor the source side at this standings row (`data-bracket-standing`). */
    place?: number;
    /** Anchor the destination side at this seat row (`data-bracket-seat`). */
    seatPosition?: number;
}

export interface ConnectorSpec {
    key: string;
    from: ConnectorAnchorSpec;
    to: ConnectorAnchorSpec;
    /** Resolved connectors (the seat's player is already known) render highlighted. */
    resolved?: boolean;
}

export interface ConnectorPath {
    key: string;
    d: string;
    resolved: boolean;
}

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface MeasuredAnchor {
    x: number;
    y: number;
    rect: Rect;
}

/**
 * Path between two slot cards of the bracket, in the classic right-angle
 * bracket style: side-by-side cards (the usual round-to-round promotion) are
 * joined by a horizontal out of the source, one turn inside the column gap
 * and a horizontal into the destination row; stacked bands (WB→LB
 * drop-downs) leave the source's bottom edge, cross over and enter the
 * destination's top edge.
 */
export function connectorPath(a: MeasuredAnchor, b: MeasuredAnchor): string {
    if (b.x >= a.rect.right - 1) {
        const midX = Math.round((a.x + b.x) / 2);
        return roundedPath([
            [a.x, a.y],
            [midX, a.y],
            [midX, b.y],
            [b.x, b.y],
        ]);
    }
    const below = b.y >= a.y;
    const y1 = below ? a.rect.bottom : a.rect.top;
    const y2 = below ? b.rect.top : b.rect.bottom;
    const x1 = (a.rect.left + a.rect.right) / 2;
    const x2 = (b.rect.left + b.rect.right) / 2;
    const midY = Math.round((y1 + y2) / 2);
    return roundedPath([
        [x1, y1],
        [x1, midY],
        [x2, midY],
        [x2, y2],
    ]);
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** Polyline through the waypoints with quadratic-rounded corners. */
function roundedPath(points: [number, number][], radius = 6): string {
    const d = [`M ${fmt(points[0][0])} ${fmt(points[0][1])}`];
    for (let i = 1; i < points.length - 1; i++) {
        const [px, py] = points[i - 1];
        const [cx, cy] = points[i];
        const [nx, ny] = points[i + 1];
        const inLen = Math.hypot(cx - px, cy - py);
        const outLen = Math.hypot(nx - cx, ny - cy);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        const inX = cx - ((cx - px) / (inLen || 1)) * r;
        const inY = cy - ((cy - py) / (inLen || 1)) * r;
        const outX = cx + ((nx - cx) / (outLen || 1)) * r;
        const outY = cy + ((ny - cy) / (outLen || 1)) * r;
        d.push(`L ${fmt(inX)} ${fmt(inY)}`, `Q ${fmt(cx)} ${fmt(cy)} ${fmt(outX)} ${fmt(outY)}`);
    }
    const [lx, ly] = points[points.length - 1];
    d.push(`L ${fmt(lx)} ${fmt(ly)}`);
    return d.join(" ");
}

function measureAnchor(
    content: HTMLElement,
    base: DOMRect,
    spec: ConnectorAnchorSpec,
    side: "source" | "target",
): MeasuredAnchor | null {
    const slot = content.querySelector(`[data-bracket-slot="${spec.slotId}"]`);
    if (!slot) return null;
    const rect = slot.getBoundingClientRect();
    const box: Rect = {
        left: rect.left - base.left,
        top: rect.top - base.top,
        right: rect.right - base.left,
        bottom: rect.bottom - base.top,
    };
    // Default anchor: the card's vertical center; a standings/seat row pins
    // the line to that row instead. Row rects are viewport-relative like the
    // card's, so they need the same base correction.
    let y = (box.top + box.bottom) / 2;
    const rowSel = side === "source"
        ? (spec.place != null && `[data-bracket-standing="${spec.place}"]`)
        : (spec.seatPosition != null && `[data-bracket-seat="${spec.seatPosition}"]`);
    const row = rowSel ? slot.querySelector(rowSel) : null;
    if (row) {
        const r = row.getBoundingClientRect();
        y = (r.top + r.bottom) / 2 - base.top;
    }
    return { x: side === "source" ? box.right : box.left, y, rect: box };
}

/**
 * Measures the connector specs against the current DOM layout of the content
 * element. Paths are re-measured whenever the specs change and whenever the
 * content's size changes (standings appearing, fonts settling, wrapping).
 */
export function useConnectorPaths(
    contentRef: RefObject<HTMLElement | null>,
    connections: ConnectorSpec[],
): ConnectorPath[] {
    const [paths, setPaths] = useState<ConnectorPath[]>([]);

    const measure = useCallback(() => {
        const content = contentRef.current;
        if (!content || connections.length === 0) {
            setPaths((prev) => (prev.length === 0 ? prev : []));
            return;
        }
        const base = content.getBoundingClientRect();
        const next: ConnectorPath[] = [];
        for (const c of connections) {
            const from = measureAnchor(content, base, c.from, "source");
            const to = measureAnchor(content, base, c.to, "target");
            if (!from || !to) continue;
            next.push({ key: c.key, d: connectorPath(from, to), resolved: c.resolved ?? false });
        }
        setPaths((prev) => {
            if (prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.d === next[i].d && p.resolved === next[i].resolved)) {
                return prev;
            }
            return next;
        });
    }, [contentRef, connections]);

    useIsomorphicLayoutEffect(() => {
        measure();
    }, [measure]);

    useEffect(() => {
        const content = contentRef.current;
        if (!content || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => measure());
        observer.observe(content);
        return () => observer.disconnect();
    }, [contentRef, measure]);

    return paths;
}

/** The SVG overlay itself: absolutely positioned over the scroll content. */
export function ConnectorLayer({ paths }: { paths: ConnectorPath[] }) {
    return (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {paths.map((p) => (
                <path
                    key={p.key}
                    d={p.d}
                    fill="none"
                    strokeWidth={1.5}
                    className={p.resolved ? "stroke-primary/50" : "stroke-muted-foreground/40"}
                />
            ))}
        </svg>
    );
}
