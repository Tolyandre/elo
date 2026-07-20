"use client";

import { VictoryPoints } from "./victory-points";
import { ScoringBadge } from "./scoring-badge";
import { ROWS, cellVP, playerTotal } from "./scoring";
import type { EditTarget, GameState } from "./scoring";

/**
 * The players × rows IAWW scoring grid with a totals row. Clicking a cell
 * invokes onEdit so the parent can open an EditDialog. When `readOnly` is
 * true, cell clicks are disabled (the table is for viewing only).
 */
export function ScoringTable({
    state,
    onEdit,
    readOnly = false,
}: {
    state: GameState;
    onEdit: (target: EditTarget) => void;
    readOnly?: boolean;
}) {
    return (
        <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
                <thead>
                    <tr>
                        <th className="sticky left-0 z-20 bg-background border border-border p-1 min-w-[3.5rem] sm:min-w-[5rem]" />
                        {state.players.map(p => (
                            <th key={p.id}
                                className="border border-border px-1 py-1 min-w-[4.5rem] sm:min-w-[6rem] text-center bg-muted">
                                <span className="block truncate max-w-[4rem] sm:max-w-[5.5rem] mx-auto text-xs sm:text-sm">
                                    {p.name}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ROWS.map((row, rowIdx) => (
                        <tr key={row.id} className={rowIdx % 2 === 0 ? "" : "bg-muted/30"}>
                            <td className="sticky left-0 z-10 bg-background border border-border p-1 text-center"
                                style={{ backgroundColor: rowIdx % 2 === 0 ? undefined : "hsl(var(--muted)/0.3)" }}>
                                {row.kind === "direct"
                                    ? <VictoryPoints hideValue />
                                    : row.kind === "pair"
                                        ? <ScoringBadge vp={row.coeff} icon={row.icon} icon2={row.icon2} />
                                        : row.icon
                                }
                            </td>

                            {state.players.map(player => {
                                let vp = 0;
                                let label: React.ReactNode = null;

                                if (row.kind === "direct") {
                                    vp = state.directVP[player.id] || 0;
                                    if (vp > 0) label = <VictoryPoints value={vp} />;
                                } else {
                                    const cell = state.multipliers[row.id]?.[player.id];
                                    vp = cellVP(cell);
                                    if (vp > 0 && cell) {
                                        label = (
                                            <div className="flex flex-col items-center gap-0.5">
                                                <span className="text-xs text-muted-foreground leading-none">
                                                    {cell.coeff}×{cell.count}
                                                </span>
                                                <VictoryPoints value={vp} />
                                            </div>
                                        );
                                    }
                                }

                                const target: EditTarget = row.kind === "direct"
                                    ? { kind: "direct", playerId: player.id }
                                    : { kind: "multiplier", rowId: row.id, playerId: player.id };

                                return (
                                    <td key={player.id}
                                        className={`border border-border p-1 text-center min-w-[4.5rem] sm:min-w-[6rem] ${
                                            readOnly
                                                ? ""
                                                : "cursor-pointer hover:bg-accent transition-colors"
                                        }`}
                                        onClick={readOnly ? undefined : () => onEdit(target)}>
                                        {label}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}

                    <tr className="bg-muted/60 font-bold">
                        <td className="sticky left-0 z-10 bg-muted/60 border border-border p-1 text-center text-xs">
                            Итого
                        </td>
                        {state.players.map(player => {
                            const total = playerTotal(state, player.id);
                            return (
                                <td key={player.id} className="border border-border p-1 text-center">
                                    {total > 0
                                        ? <VictoryPoints value={total} />
                                        : <span className="text-muted-foreground">—</span>
                                    }
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}
