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
 * `lane` shifts the vertical segment per connector sharing the same descent
 * lane, so parallel lines run side by side instead of overlapping into one
 * thick stroke; `lanePitch` is the shift per lane (compressed below the
 * usual 6px by laneAssignments when the gap is tight). A descent may never
 * slip left of the source card's right edge — it would vanish under the
 * card — so the floor clamps it just clear of the edge. `radius` softens
 * the corners.
 */
export function connectorPath(
    a: MeasuredAnchor,
    b: MeasuredAnchor,
    lane = 0,
    lanePitch = 6,
    radius = 6,
): string {
    if (b.x >= a.rect.right - 1) {
        const base = Math.min(16, (b.x - a.rect.right) / 2);
        const midX = Math.max(
            Math.round(b.x - base - lane * lanePitch),
            Math.min(Math.round(a.rect.right) + 4, Math.round(b.x) - 4),
        );
        return roundedPath([
            [a.x, a.y],
            [midX, a.y],
            [midX, b.y],
            [b.x, b.y],
        ], radius);
    }
    const laneX = Math.round(b.x - 12 - lane * lanePitch);
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
        // Connectors sharing a descent lane get neighboring lane indexes so
        // their vertical segments run side by side instead of overlapping
        // into one stroke — promotions bucket by destination column, drops
        // hug their source card (see laneAssignments, which also compresses
        // the promotion lane pitch when a tight destination gap needs it).
        const lanes = laneAssignments(measured);
        const next: ConnectorPath[] = measured.map((m) => {
            const { lane, pitch } = lanes.get(m.key) ?? { lane: 0, pitch: 6 };
            return {
                key: m.key,
                d: m.kind === "drop" ? dropPath(m.from, m.to, lane) : connectorPath(m.from, m.to, lane, pitch),
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

/** Lane index and lane spacing (px) for one connector's descent. */
export interface LaneAssignment {
    lane: number;
    pitch: number;
}

interface BucketItem {
    key: string;
    /** Upper edge of the connector (source row for drops, min row otherwise). */
    y: number;
    tie: number;
    floor: number;
    anchor: number;
    drop: boolean;
    fromY: number;
    toY: number;
    fromRight: number;
    bx: number;
}

/**
 * Segment crossings inside one lane order, evaluated at the full-width lane
 * pitch — only the relative order matters. With the descent of lane i at
 * `bx - 16 - i*6`, a right connector's exit stub can only reach a left
 * connector's vertical, and only when its source row falls inside that
 * vertical's span; symmetrically a left connector's entry row can only hit
 * a right vertical. Same-source rising fans are the asymmetric case: the
 * upper row belongs on the deeper lane.
 */
function crossingCount(order: BucketItem[]): number {
    let total = 0;
    for (let i = 0; i < order.length; i++) {
        for (let j = i + 1; j < order.length; j++) {
            const right = order[i];
            const left = order[j];
            const xLeft = left.bx - 16 - j * 6;
            const rightLo = Math.min(right.fromY, right.toY);
            const rightHi = Math.max(right.fromY, right.toY);
            const leftLo = Math.min(left.fromY, left.toY);
            const leftHi = Math.max(left.fromY, left.toY);
            if (xLeft > right.fromRight && right.fromY >= leftLo && right.fromY <= leftHi) total++;
            if (left.toY >= rightLo && left.toY <= rightHi) total++;
        }
    }
    return total;
}

/**
 * Reorder a bucket's promotions (drops keep their slots) so the connectors
 * cross each other as few times as possible — two cards joined by several
 * connectors must not weave through one another when a neighboring lane
 * order avoids it. Exhaustive over the realistic sizes (a slot has a
 * handful of seats), keeping the upper-edge baseline on ties.
 */
function minimizeCrossings(list: BucketItem[]): void {
    const slots: number[] = [];
    const promos: BucketItem[] = [];
    list.forEach((item, i) => {
        if (!item.drop) {
            slots.push(i);
            promos.push(item);
        }
    });
    if (promos.length < 2 || promos.length > 7) return;
    let best = promos.slice();
    let bestCount = crossingCount(best);
    const perm = promos.slice();
    const walk = (k: number) => {
        if (k === promos.length) {
            const count = crossingCount(perm);
            if (count < bestCount) {
                bestCount = count;
                best = perm.slice();
            }
            return;
        }
        for (let i = k; i < promos.length; i++) {
            [perm[k], perm[i]] = [perm[i], perm[k]];
            walk(k + 1);
            [perm[k], perm[i]] = [perm[i], perm[k]];
        }
    };
    walk(0);
    slots.forEach((slot, i) => {
        list[slot] = best[i];
    });
}

/**
 * Lane assignment per connector key. Promotions turn just before their
 * destination column, so elbows sharing it bucket by that column's x;
 * drops hug their source instead, so they bucket by the source card's
 * right edge. Within a bucket, lines get neighboring lanes ordered to
 * keep the segment crossings down (baseline: by upper edge — source row
 * for drops, min row otherwise), so parallel descents run side by side
 * instead of overlapping into one stroke or weaving through each other.
 * A promotion bucket also gets a lane pitch: the usual 6px is compressed
 * just enough that even the deepest lane stays right of its source card —
 * a tight gap then packs the descents closer together rather than hiding
 * one of them under the card.
 */
export function laneAssignments(
    measured: { key: string; kind: "promotion" | "drop"; from: MeasuredAnchor; to: MeasuredAnchor }[],
): Map<string, LaneAssignment> {
    const buckets = new Map<number, BucketItem[]>();
    for (const m of measured) {
        const drop = m.kind === "drop";
        const bucket = Math.round(drop ? m.from.rect.right : m.to.rect.left);
        const base = Math.min(16, (m.to.x - m.from.rect.right) / 2);
        const item: BucketItem = {
            key: m.key,
            y: drop ? m.from.y : Math.min(m.from.y, m.to.y),
            tie: m.to.y,
            // Deepest-lane bounds for promotions: the descent must stay
            // right of the source card (floor) and left of the lane-0
            // anchor just before the destination column.
            floor: m.from.rect.right + 4,
            anchor: m.to.x - base,
            drop,
            fromY: m.from.y,
            toY: m.to.y,
            fromRight: m.from.rect.right,
            bx: m.to.x,
        };
        const list = buckets.get(bucket);
        if (list) list.push(item);
        else buckets.set(bucket, [item]);
    }
    const lanes = new Map<string, LaneAssignment>();
    for (const list of buckets.values()) {
        list.sort((p, q) => p.y - q.y || p.tie - q.tie);
        minimizeCrossings(list);
        // The descent of lane i sits at anchor_i - i*pitch (connectorPath),
        // so the shared pitch must keep every promotion's descent right of
        // its own source card: pitch ≤ (anchor_i - floor_i) / i. Wide gaps
        // keep the full 6px; a tight gap compresses just enough (down to
        // 3px) to pack the descents visibly apart rather than clamping any
        // of them onto its neighbor or under the card.
        let pitch = 6;
        for (const [i, item] of list.entries()) {
            if (item.drop || i === 0) continue;
            pitch = Math.min(pitch, (item.anchor - item.floor) / i);
        }
        pitch = Math.min(6, Math.max(3, pitch));
        list.forEach((item, i) => lanes.set(item.key, { lane: i, pitch: item.drop ? 6 : pitch }));
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
