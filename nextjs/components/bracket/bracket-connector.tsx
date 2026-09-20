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
    /**
     * `drop` marks the WB→LB crossings: dashed curves allowed to pass under
     * the cards, so they never share the promotion elbows' lanes.
     */
    kind?: "promotion" | "drop";
}

export interface ConnectorPath {
    key: string;
    d: string;
    resolved: boolean;
    kind: "promotion" | "drop";
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
 * joined by a horizontal out of the source, one turn in the lane just before
 * the destination column and a horizontal into the destination row — for
 * adjacent columns that lane is the shared gap's midpoint; for spans across
 * other columns it keeps the descent out of the cards, and the long
 * horizontal stays at the source's height, which its band keeps clear.
 * Overlapping columns leave the source's left edge instead and descend
 * through that same lane, so the line never runs over the cards stacked
 * between the source and the target row. (WB→LB drops route differently —
 * see dropPath.)
 *
 * `lane` shifts the vertical segment a few pixels per connector sharing the
 * same descent lane, so parallel lines run side by side instead of
 * overlapping into one thick stroke. `radius` softens the corners.
 */
export function connectorPath(a: MeasuredAnchor, b: MeasuredAnchor, lane = 0, radius = 6): string {
    if (b.x >= a.rect.right - 1) {
        const base = Math.min(16, (b.x - a.rect.right) / 2);
        const midX = Math.round(b.x - base - lane * 6);
        return roundedPath([
            [a.x, a.y],
            [midX, a.y],
            [midX, b.y],
            [b.x, b.y],
        ], radius);
    }
    const laneX = Math.round(b.x - 12 - lane * 6);
    return roundedPath([
        [a.rect.left, a.y],
        [laneX, a.y],
        [laneX, b.y],
        [b.x, b.y],
    ], radius);
}

/**
 * WB→LB drop. The descent hugs the source: it turns down in the gap right
 * of the source card and runs the long horizontal at the target row's
 * height — a drop always falls from the winners band into the losers band,
 * so that horizontal passes only beneath columns of the band above and
 * stays visible, while the descent's position tells which table the line
 * came from. Drops from one card descend side by side (`lane`); wide
 * corners, dashes and the drop color keep them distinct from promotions.
 * Crossing the cards on the way down is fine — the cards render above the
 * connector layer.
 */
export function dropPath(a: MeasuredAnchor, b: MeasuredAnchor, lane = 0): string {
    if (b.x >= a.rect.right - 1) {
        const x = Math.round(a.rect.right + 8 + lane * 6);
        return roundedPath([
            [a.x, a.y],
            [x, a.y],
            [x, b.y],
            [b.x, b.y],
        ], 12);
    }
    // Overlapping columns (the target renders under the source): the
    // rightward exit would run backward, so leave the source's left edge
    // and descend just before the target column instead.
    const laneX = Math.round(b.x - 12 - lane * 6);
    return roundedPath([
        [a.rect.left, a.y],
        [laneX, a.y],
        [laneX, b.y],
        [b.x, b.y],
    ], 12);
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
        const measured: { key: string; kind: "promotion" | "drop"; resolved: boolean; from: MeasuredAnchor; to: MeasuredAnchor }[] = [];
        for (const c of connections) {
            const from = measureAnchor(content, base, c.from, "source");
            const to = measureAnchor(content, base, c.to, "target");
            if (from && to) measured.push({ key: c.key, kind: c.kind ?? "promotion", resolved: c.resolved ?? false, from, to });
        }
        // Connectors sharing a descent lane get successive lane indexes so
        // their vertical segments run side by side instead of overlapping
        // into one stroke — promotions bucket by destination column, drops
        // hug their source card (see laneAssignments).
        const lanes = laneAssignments(measured);
        const next: ConnectorPath[] = measured.map((m) => {
            const lane = lanes.get(m.key) ?? 0;
            return {
                key: m.key,
                d: m.kind === "drop" ? dropPath(m.from, m.to, lane) : connectorPath(m.from, m.to, lane),
                resolved: m.resolved,
                kind: m.kind,
            };
        });
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

/**
 * Lane index per connector key. Promotions turn just before their
 * destination column, so elbows sharing it bucket by that column's x;
 * drops hug their source instead, so they bucket by the source card's
 * right edge. Within a bucket, lines get neighboring lanes ordered by
 * their upper edge (source row for drops, ties by target row), so
 * parallel descents run side by side instead of overlapping into one
 * stroke.
 */
export function laneAssignments(
    measured: { key: string; kind: "promotion" | "drop"; from: MeasuredAnchor; to: MeasuredAnchor }[],
): Map<string, number> {
    const buckets = new Map<number, { key: string; y: number; tie: number }[]>();
    for (const m of measured) {
        const drop = m.kind === "drop";
        const bucket = Math.round(drop ? m.from.rect.right : m.to.rect.left);
        const item = { key: m.key, y: drop ? m.from.y : Math.min(m.from.y, m.to.y), tie: m.to.y };
        const list = buckets.get(bucket);
        if (list) list.push(item);
        else buckets.set(bucket, [item]);
    }
    const lanes = new Map<string, number>();
    for (const list of buckets.values()) {
        list.sort((p, q) => p.y - q.y || p.tie - q.tie);
        list.forEach((item, i) => lanes.set(item.key, i));
    }
    return lanes;
}

/**
 * The SVG overlay itself: absolutely positioned over the scroll content, at
 * z-0 so the (relative, z-10) slot cards stay in the foreground — the WB→LB
 * drop curves are allowed to pass beneath them.
 */
export function ConnectorLayer({
    paths,
    highlight,
}: {
    paths: ConnectorPath[];
    /** Connector keys to spotlight; every other line dims while set. */
    highlight?: Set<string>;
}) {
    const active = highlight != null && highlight.size > 0;
    return (
        <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden="true">
            {paths.map((p) => {
                const hot = active && highlight.has(p.key);
                const dim = active && !hot;
                const kind = p.kind;
                return (
                    <path
                        key={p.key}
                        data-connector-key={p.key}
                        d={p.d}
                        fill="none"
                        strokeWidth={hot ? 2.25 : 1.5}
                        strokeDasharray={kind === "drop" ? "7 5" : undefined}
                        opacity={dim ? 0.15 : 1}
                        className={
                            hot
                                ? kind === "drop" ? "stroke-chart-1" : "stroke-primary"
                                : kind === "drop"
                                    ? "stroke-chart-1/40"
                                    : p.resolved
                                        ? "stroke-primary/50"
                                        : "stroke-muted-foreground/40"
                        }
                    />
                );
            })}
        </svg>
    );
}
