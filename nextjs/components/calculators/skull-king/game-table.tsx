"use client";

import { calcRoundScore } from "./scoring";
import type { GameState } from "./scoring";

/**
 * The rounds × players Skull King score grid with totals row. Pure presentational
 * component — caller owns state. Supports bid masking (for non-host players in
 * live multiplayer), hidden totals, and plan-round highlighting.
 *
 * Clicking a cell invokes onCellClick (host can edit). For history read-only
 * mode, the parent simply does not pass onCellClick.
 */
export function GameTable({
    state,
    onCellClick,
    maskedRoundIndex,
    hideTotalPlayerIndices,
    planRoundIndex,
}: {
    state: GameState;
    onCellClick?: (roundIndex: number, playerIndex: number) => void;
    maskedRoundIndex?: number;
    hideTotalPlayerIndices?: number[];
    planRoundIndex?: number;
}) {
    const { players, rounds } = state;
    const lastRoundIndex = rounds.length - 1;
    const clickable = !!onCellClick;

    const totals = players.map((_, pi) =>
        rounds.reduce((sum, round, ri) => {
            const entry = round[pi];
            if (!entry || entry.actual === null) return sum;
            return sum + calcRoundScore(entry, ri + 1, players.length);
        }, 0)
    );

    const headerCells = (
        <>
            <th className="border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center bg-muted min-w-12 md:min-w-16"></th>
            {players.map((p) => (
                <th key={p.id} className="border border-border px-1 py-0.5 md:px-2 md:py-1.5 text-center bg-muted min-w-[2.5rem] sm:min-w-20 md:min-w-24">
                    <span className="inline-block [writing-mode:vertical-lr] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0 sm:max-w-none truncate">
                        {p.name}
                    </span>
                </th>
            ))}
        </>
    );

    return (
        <div className="overflow-x-auto max-w-full">
            <table className="border-collapse text-sm md:text-base">
                <thead>
                    <tr>{headerCells}</tr>
                </thead>
                <tbody>
                    {rounds.map((round, ri) => {
                        const isLastRound = ri === lastRoundIndex;
                        return (
                            <tr key={ri}>
                                <td className="border border-border px-2 py-0.5 md:px-3 md:py-1.5 text-center font-medium bg-muted/50">
                                    {ri + 1}
                                </td>
                                {players.map((_, pi) => {
                                    const entry = round[pi];
                                    if (!entry) return <td key={pi} className="border border-border px-2 py-0.5" />;
                                    const isMasked = maskedRoundIndex !== undefined && ri === maskedRoundIndex;
                                    const isClickable = clickable && !isMasked;
                                    const score = !isMasked && entry.actual !== null
                                        ? calcRoundScore(entry, ri + 1, players.length)
                                        : null;
                                    const scoreDisplay = score !== null
                                        ? entry.bonus > 0
                                            ? `${score - entry.bonus > 0 ? "+" : ""}${score - entry.bonus}+${entry.bonus}`
                                            : `${score > 0 ? "+" : ""}${score}`
                                        : null;
                                    const scalePct = isLastRound ? 1 : 0.75;
                                    const isPlanCell = planRoundIndex !== undefined && ri === planRoundIndex && entry.actual === null;
                                    return (
                                        <td
                                            key={pi}
                                            className={`border border-border px-1 py-0.5 md:px-3 md:py-1.5 text-center ${isPlanCell ? "" : "[container-type:inline-size]"} ${isClickable ? "cursor-pointer hover:bg-accent" : ""}`}
                                            onClick={() => isClickable && onCellClick!(ri, pi)}
                                        >
                                            {isPlanCell ? (
                                                <span className="text-base md:text-lg font-bold tabular-nums">{isMasked ? "?" : entry.bid}</span>
                                            ) : (
                                                <div className="flex flex-col items-center leading-tight">
                                                    <span className="text-muted-foreground text-center whitespace-nowrap" style={{ fontSize: `clamp(${6 * scalePct}px, ${6 * scalePct}cqi, ${12 * scalePct}px)` }}>
                                                        {entry.actual !== null ? entry.actual : ""}/{isMasked ? "?" : entry.bid}
                                                    </span>
                                                    <span className={`font-semibold text-center whitespace-nowrap ${score! < 0 ? "text-red-600" : "text-green-700"}`} style={{ fontSize: `clamp(${6 * scalePct}px, ${7 * scalePct}cqi, ${14 * scalePct}px)` }}>
                                                        {scoreDisplay ?? ""}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    {/* Repeated header row before totals for easy reading */}
                    {rounds.length > 0 && (
                        <tr>{headerCells}</tr>
                    )}
                    {/* Totals row */}
                    {rounds.length > 0 && (
                        <tr className="bg-muted/50">
                            <td className="border border-border px-2 py-1 md:px-3 md:py-2 text-center text-base md:text-lg font-bold">Σ</td>
                            {totals.map((total, pi) => {
                                const isHidden = hideTotalPlayerIndices?.includes(pi);
                                return (
                                    <td key={pi} className={`border border-border px-2 py-1 md:px-3 md:py-2 text-center text-base md:text-lg font-bold ${isHidden ? "text-muted-foreground" : total < 0 ? "text-red-600" : "text-green-700"}`}>
                                        {isHidden ? "—" : total}
                                    </td>
                                );
                            })}
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
