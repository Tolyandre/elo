"use client";

import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    XAxis,
    YAxis,
} from "recharts";
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { calcRoundScore, type GameState } from "./scoring";

// Player line colors run through the theme's chart palette (10 entries, see
// globals.css); the first six are a deliberately wide spread of hues since
// games of up to six players are the common case.
const CHART_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--chart-6)",
    "var(--chart-7)",
    "var(--chart-8)",
    "var(--chart-9)",
    "var(--chart-10)",
] as const;

/** One chart point per round: the running total of every player after it. */
export type ScoreChartPoint = {
    round: number;
    // Keyed by player id; an absent entry means "no plotted value at this round".
    [playerId: string]: number | undefined;
};

/**
 * Chart twin of the Σ row in GameTable: cumulative totals after each round
 * that has at least one recorded result. A player whose total is hidden
 * (see GameTable's hideTotalPlayerIndices) keeps their line only up to the
 * last fully completed round, so a partially entered round never leaks a
 * hidden total.
 */
export function buildScoreChartData(
    state: GameState,
    hideTotalPlayerIndices?: number[],
): ScoreChartPoint[] {
    const { players, rounds } = state;
    const playerCount = players.length;
    if (playerCount === 0) return [];

    const hidden = new Set(hideTotalPlayerIndices ?? []);
    // A round is completed when every player has a recorded result.
    const completed = rounds.map((round) =>
        players.every((_, pi) => (round[pi]?.actual ?? null) !== null),
    );

    const points: ScoreChartPoint[] = [];
    const running = players.map(() => 0);
    for (let ri = 0; ri < rounds.length; ri++) {
        let anyResult = false;
        for (let pi = 0; pi < playerCount; pi++) {
            const entry = rounds[ri][pi];
            if (entry && entry.actual !== null) {
                running[pi] += calcRoundScore(entry, ri + 1, playerCount);
                anyResult = true;
            }
        }
        if (!anyResult) continue;
        const point: ScoreChartPoint = { round: ri + 1 };
        players.forEach((p, pi) => {
            if (hidden.has(pi) && !completed[ri]) return;
            point[p.id] = running[pi];
        });
        points.push(point);
    }
    return points;
}

/** Standard "nice" tick step (1/2/2.5/5 × 10^k) for a target raw step value. */
function niceStep(raw: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return nice * mag;
}

/**
 * Players' cumulative score lines across rounds. Pure presentational — the
 * caller owns state, same as GameTable.
 */
export function ScoreChart({
    state,
    hideTotalPlayerIndices,
}: {
    state: GameState;
    hideTotalPlayerIndices?: number[];
}) {
    const { players } = state;
    const data = buildScoreChartData(state, hideTotalPlayerIndices);

    if (players.length === 0 || data.length === 0) {
        return <p className="text-muted-foreground text-sm">Нет данных</p>;
    }

    const config: ChartConfig = {};
    players.forEach((p, pi) => {
        config[p.id] = { label: p.name, color: CHART_COLORS[pi % CHART_COLORS.length] };
    });

    // The Y axis hugs the actual data extent instead of recharts' "auto"
    // nice-rounding, which pads far past any real score; 0 is always in range
    // so the zero baseline stays visible. Ticks land on round multiples of a
    // "nice" step inside that range.
    const values = data.flatMap((point) => players.map((p) => point[p.id]));
    const numbers = values.filter((v): v is number => typeof v === "number");
    const lo = Math.min(0, ...numbers);
    const hi = Math.max(0, ...numbers);
    const pad = Math.max((hi - lo) * 0.05, 5);
    const yLo = lo - pad;
    const yHi = hi + pad;
    const step = niceStep((yHi - yLo) / 6);
    const ticks: number[] = [];
    for (let t = Math.ceil(yLo / step) * step; t <= yHi; t += step) ticks.push(t);

    return (
        <ChartContainer className="aspect-auto h-60 w-full" config={config}>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                    dataKey="round"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                />
                <YAxis
                    domain={[yLo, yHi]}
                    ticks={ticks}
                    allowDecimals={false}
                    width={40}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                />
                {/* Zero baseline: scores go negative on failed bids. */}
                <ReferenceLine y={0} stroke="var(--border)" />
                <ChartLegend content={<ChartLegendContent />} />
                {players.map((p) => (
                    <Line
                        key={p.id}
                        type="monotone"
                        dataKey={p.id}
                        stroke={`var(--color-${p.id})`}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        name={p.name}
                    />
                ))}
            </LineChart>
        </ChartContainer>
    );
}
