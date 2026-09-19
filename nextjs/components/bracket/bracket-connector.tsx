"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

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
    /**
     * Anchor this side at the standings row of this place
     * (`data-bracket-standing`) — the player's name row.
     */
    place?: number;
    /**
     * Anchor this side at this seat row (`data-bracket-seat`) — the seat
     * placeholder used before results exist.
     */
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
 * bracket style: side-by-side cards (the usual round-to-round promotion, and
 * the WB→LB drop-downs of the interleaved double-elim layout) are joined by
 * a horizontal out of the source, one turn in the lane just before the
 * destination column and a horizontal into the destination row — for
 * adjacent columns that lane is the shared gap's midpoint; for spans across
 * other columns it keeps the descent out of the cards, and the long
 * horizontal stays at the source's height, which its band keeps clear.
 * Overlapping columns (a cross-band drop into the column below) leave the
 * source's left edge instead and descend through that same lane, so the
 * line never runs over the cards stacked between the source and the target
 * row.
 */
export function connectorPath(a: MeasuredAnchor, b: MeasuredAnchor): string {
    if (b.x >= a.rect.right - 1) {
        const midX = Math.round(b.x - Math.min(16, (b.x - a.rect.right) / 2));
        return roundedPath([
            [a.x, a.y],
            [midX, a.y],
            [midX, b.y],
            [b.x, b.y],
        ]);
    }
    const laneX = Math.round(b.x - 12);
    return roundedPath([
        [a.rect.left, a.y],
        [laneX, a.y],
        [laneX, b.y],
        [b.x, b.y],
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
    // Default anchor: the card's vertical center. A standings row pins the
    // line to that player's name row, a seat row to the seat placeholder —
    // on either side (standings win when both are given).
    let y = (box.top + box.bottom) / 2;
    const row = spec.place != null
        ? slot.querySelector(`[data-bracket-standing="${spec.place}"]`)
        : spec.seatPosition != null
            ? slot.querySelector(`[data-bracket-seat="${spec.seatPosition}"]`)
            : null;
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
    const signature = useRef("");

    const measure = useCallback(() => {
        const content = contentRef.current;
        if (!content || connections.length === 0) {
            if (signature.current !== "") {
                signature.current = "";
                setPaths((prev) => (prev.length === 0 ? prev : []));
            }
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
        // Skip the state update entirely when nothing moved — the deferred
        // re-measures (after paint, after webfonts settle) must not wake
        // React for identical geometry.
        const sig = next.map((p) => `${p.key}:${p.resolved ? 1 : 0}:${p.d}`).join("|");
        if (sig === signature.current) return;
        signature.current = sig;
        setPaths(next);
    }, [contentRef, connections]);

    useIsomorphicLayoutEffect(() => {
        measure();
        // The first measure can land on not-yet-final layout (webfonts still
        // swapping, scrollbars appearing): re-check after the browser has
        // painted and once fonts settle, so no connector keeps a stale
        // anchor or stays missing.
        let raf = 0;
        let raf2 = 0;
        raf = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(measure);
        });
        let cancelled = false;
        document.fonts?.ready.then(() => {
            if (!cancelled) measure();
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            cancelAnimationFrame(raf2);
        };
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
