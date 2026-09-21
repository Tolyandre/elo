"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bracket, BracketRound, BracketSeat, BracketSlot } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { roundTitle, seatSourceLabel, slotStatusLabel, trackLabel } from "../labels";
import { groupByTrack, offsetSpacers, roundColumnOffsets } from "../bracket-structure";
import { ConnectorLayer, useConnectorPaths, type ConnectorSpec } from "@/components/bracket/bracket-connector";
import { Badge } from "@/components/ui/badge";
import { RankIcon } from "@/components/rank-icon";

/**
 * What a click on a bracket row spotlights: either a player (every seat and
 * standings row they occupy across the bracket, plus the promotion lines
 * between them) or an unresolved seat placeholder (its incoming line and the
 * source row it will be filled from).
 */
interface Selection {
    playerId?: string;
    slotId?: string;
    seatPosition?: number;
}

/**
 * The bracket (ADR-26 §UI): a pure rendering of the GET /bracket DTO —
 * a column per round grouped into stacked track bands (Победители over
 * Проигравшие, the grand final to the right of both), losers rounds offset
 * a column right of the deepest winners round they draw seats from, with
 * promotion lines drawn from each seat's source slot. No client-side bracket
 * logic.
 */
export function BracketView({ bracket }: { bracket: Bracket }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<Selection | null>(null);

    const bands = useMemo(() => groupByTrack(bracket.rounds), [bracket.rounds]);
    const finalBand = bands.find((b) => b.track === "final");
    const trackBands = bands.filter((b) => b.track !== "final");

    // Round of every slot: resolves seat provenance («из стола N») and the
    // WB→LB crossings that render as dashed drop curves.
    const slotRound = useMemo(() => {
        const map = new Map<string, BracketRound>();
        for (const round of bracket.rounds) {
            for (const slot of round.slots) map.set(slot.id, round);
        }
        return map;
    }, [bracket.rounds]);

    // Seat provenance («из стола N») resolves the source slot's table number.
    const slotPositions = useMemo(() => {
        const map = new Map<string, number>();
        for (const round of bracket.rounds) {
            for (const slot of round.slots) map.set(slot.id, slot.position);
        }
        return map;
    }, [bracket.rounds]);

    // Which winners round each round draws from (via its seats' source
    // slots) drives the double-elim column interleave: a losers round renders
    // under the winners round it runs alongside. Offsets are global column
    // positions; spacer counts are derived per band, because every band's
    // row starts at column 0.
    const roundOffsets = useMemo(() => {
        const winnersSource = (round: BracketRound): number => {
            let max = 0;
            for (const slot of round.slots) {
                for (const seat of slot.seats) {
                    const src = seat.source_slot_id ? slotRound.get(seat.source_slot_id) : undefined;
                    if (src?.track === "winners") max = Math.max(max, src.index);
                }
            }
            return max;
        };
        const byRound = new Map<string, number>();
        roundColumnOffsets(bracket.rounds, winnersSource).forEach((offset, i) => {
            const round = bracket.rounds[i];
            byRound.set(`${round.track}-${round.index}`, offset);
        });
        return byRound;
    }, [bracket.rounds, slotRound]);

    // The connector graph plus the indexes behind click-to-trace: one
    // connector per seat with a known source slot (the line the promoted
    // player — or the pending place — travels along), and per-player row
    // sets so a click highlights the player's whole path through the bracket.
    const graph = useMemo(() => {
        const specs: ConnectorSpec[] = [];
        const specBySeat = new Map<string, ConnectorSpec>();
        const connKeysByPlayer = new Map<string, Set<string>>();
        const seatRowsByPlayer = new Map<string, Set<string>>();
        const standingRowsByPlayer = new Map<string, Set<string>>();
        for (const round of bracket.rounds) {
            for (const slot of round.slots) {
                for (const st of slot.standings) {
                    const set = standingRowsByPlayer.get(st.player_id) ?? new Set<string>();
                    set.add(`${slot.id}:${st.place}`);
                    standingRowsByPlayer.set(st.player_id, set);
                }
                for (const seat of slot.seats) {
                    if (seat.player_id) {
                        const set = seatRowsByPlayer.get(seat.player_id) ?? new Set<string>();
                        set.add(`${slot.id}:${seat.position}`);
                        seatRowsByPlayer.set(seat.player_id, set);
                    }
                    if (!seat.source_slot_id) continue;
                    const srcRound = slotRound.get(seat.source_slot_id);
                    const place = slot.standings.find((st) => st.player_id === seat.player_id)?.place;
                    const spec: ConnectorSpec = {
                        key: `${slot.id}:${seat.position}`,
                        from: { slotId: seat.source_slot_id, place: seat.source_place ?? undefined },
                        to: { slotId: slot.id, seatPosition: seat.position, place },
                        resolved: seat.player_id != null,
                        kind: srcRound?.track === "winners" && round.track === "losers" ? "drop" : "promotion",
                    };
                    specs.push(spec);
                    specBySeat.set(spec.key, spec);
                    if (seat.player_id) {
                        const set = connKeysByPlayer.get(seat.player_id) ?? new Set<string>();
                        set.add(spec.key);
                        connKeysByPlayer.set(seat.player_id, set);
                    }
                }
            }
        }
        return { specs, specBySeat, connKeysByPlayer, seatRowsByPlayer, standingRowsByPlayer };
    }, [bracket.rounds, slotRound]);

    const paths = useConnectorPaths(contentRef, graph.specs);

    // Rows are keyed `seat:${slotId}:${seatPosition}` and
    // `place:${slotId}:${place}` — the same keys SlotCard checks per row.
    const highlight = useMemo(() => {
        if (!selected) return null;
        const rows = new Set<string>();
        const conns = new Set<string>();
        if (selected.playerId) {
            for (const r of graph.seatRowsByPlayer.get(selected.playerId) ?? []) rows.add(`seat:${r}`);
            for (const r of graph.standingRowsByPlayer.get(selected.playerId) ?? []) rows.add(`place:${r}`);
            for (const k of graph.connKeysByPlayer.get(selected.playerId) ?? []) conns.add(k);
        } else if (selected.slotId && selected.seatPosition != null) {
            rows.add(`seat:${selected.slotId}:${selected.seatPosition}`);
            // An unresolved seat has no player to trace, so show its
            // provenance instead: the incoming line and the row it will be
            // filled from.
            const spec = graph.specBySeat.get(`${selected.slotId}:${selected.seatPosition}`);
            if (spec) {
                conns.add(spec.key);
                const src = spec.from.place != null
                    ? `place:${spec.from.slotId}:${spec.from.place}`
                    : spec.from.seatPosition != null
                        ? `seat:${spec.from.slotId}:${spec.from.seatPosition}`
                        : null;
                if (src) rows.add(src);
            }
        }
        return rows.size + conns.size > 0 ? { rows, conns } : null;
    }, [selected, graph]);

    const toggleRow = useCallback((sel: Selection) => {
        setSelected((prev) =>
            prev != null &&
            prev.playerId === sel.playerId &&
            prev.slotId === sel.slotId &&
            prev.seatPosition === sel.seatPosition
                ? null
                : sel,
        );
    }, []);

    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelected(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selected]);

    const roundColumns = (rounds: BracketRound[]) => {
        const spacers = offsetSpacers(rounds.map((r) => roundOffsets.get(`${r.track}-${r.index}`) ?? 0));
        return rounds.map((round, ri) => (
            <Fragment key={`${round.track}-${round.index}`}>
                {Array.from({ length: spacers[ri] }, (_, i) => (
                    <div key={i} aria-hidden className="w-56 shrink-0" />
                ))}
                <RoundColumn
                    round={round}
                    elimination={bracket.elimination}
                    slotPositions={slotPositions}
                    highlightRows={highlight?.rows}
                    onSelectRow={toggleRow}
                />
            </Fragment>
        ));
    };

    // The final band follows the tracks grid as a whole — only winners/losers
    // rounds share the interleaved column grid, the final rounds sit
    // consecutive.
    const finalColumns = (rounds: BracketRound[]) =>
        rounds.map((round) => (
            <RoundColumn
                key={`${round.track}-${round.index}`}
                round={round}
                elimination={bracket.elimination}
                slotPositions={slotPositions}
                highlightRows={highlight?.rows}
                onSelectRow={toggleRow}
            />
        ));

    return (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
            {/* A click anywhere but a player row clears the selection; the
                rows stopPropagation, so this only sees clicks past them. */}
            <div
                ref={contentRef}
                className="relative flex min-w-max items-stretch gap-8"
                onClick={() => setSelected(null)}
            >
                <ConnectorLayer paths={paths} highlight={highlight?.conns} />
                {/* Above the connector layer (z-0): the WB→LB drop curves are
                    allowed to pass beneath the cards. */}
                <div className="relative z-10 flex flex-col gap-8">
                    {trackBands.map(({ track, rounds }) => (
                        <section key={track} className="flex flex-col gap-2">
                            {trackBands.length > 1 && (
                                <h2 className="text-sm font-semibold text-muted-foreground">{trackLabel(track)}</h2>
                            )}
                            <div className="flex flex-1 items-stretch gap-8">
                                {roundColumns(rounds)}
                            </div>
                        </section>
                    ))}
                </div>
                {finalBand && (
                    <section className="relative z-10 flex flex-col gap-2">
                        <div className="flex flex-1 items-stretch gap-8">
                            {finalColumns(finalBand.rounds)}
                        </div>
                    </section>
                )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                Сплошные линии — переходы между столами, пунктир — падение в нижнюю сетку.
                Нажмите на имя игрока или плейсхолдер, чтобы подсветить его путь; клик мимо снимает подсветку.
            </p>
        </div>
    );
}

function RoundColumn({
    round,
    elimination,
    slotPositions,
    highlightRows,
    onSelectRow,
}: {
    round: BracketRound;
    elimination: Bracket["elimination"];
    slotPositions: Map<string, number>;
    highlightRows?: Set<string>;
    onSelectRow: (sel: Selection) => void;
}) {
    return (
        <div className="flex w-56 flex-col">
            <h3 className="mb-2 text-center text-sm font-medium text-muted-foreground">
                {roundTitle(round.track, round.index, elimination)}
            </h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
                {round.slots.map((slot) => (
                    <SlotCard
                        key={slot.id}
                        slot={slot}
                        slotPositions={slotPositions}
                        highlightRows={highlightRows}
                        onSelectRow={onSelectRow}
                    />
                ))}
            </div>
        </div>
    );
}

function SlotCard({
    slot,
    slotPositions,
    highlightRows,
    onSelectRow,
}: {
    slot: BracketSlot;
    slotPositions: Map<string, number>;
    highlightRows?: Set<string>;
    onSelectRow: (sel: Selection) => void;
}) {
    const { playerMap, playerDisplayName } = usePlayers();
    const { games } = useGames();
    const gameName = games.find((g) => g.id === slot.game_id)?.name;

    const playerName = (pid: string): string => {
        const player = playerMap.get(pid);
        return player ? playerDisplayName(player) : pid;
    };

    const standings = [...slot.standings].sort((a, b) => a.place - b.place);

    const seatHint = (seat: BracketSeat): string | undefined => {
        const sourcePos = seat.source_slot_id ? slotPositions.get(seat.source_slot_id) : undefined;
        return sourcePos != null ? seatSourceLabel(sourcePos, seat.source_place) : undefined;
    };

    const seatRowClass = (hot: boolean) =>
        `flex cursor-pointer items-center rounded-md px-1 -mx-1 text-sm truncate transition-colors hover:bg-muted/60 ${
            hot ? "bg-primary/10 ring-1 ring-primary/40" : ""
        }`;

    return (
        <div data-bracket-slot={slot.id} className="rounded-xl border bg-card text-card-foreground p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium min-w-0 truncate">
                    Стол {slot.position}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                    <Badge variant={slotBadgeVariant(slot.status)} className="whitespace-nowrap">
                        {slotStatusLabel(slot.status)}
                    </Badge>
                </span>
            </div>
            {gameName && <p className="text-xs text-muted-foreground truncate">{gameName}</p>}

            {/* Before results exist the seat list carries the names (with
                the provenance as a tooltip); once standings show them, the
                promotion lines anchor straight at the standings rows. */}
            {standings.length === 0 && (
                <ul className="space-y-1">
                    {[...slot.seats].sort((a, b) => a.position - b.position).map((seat) => (
                        <li
                            key={seat.position}
                            data-bracket-seat={seat.position}
                            data-highlighted={
                                highlightRows?.has(`seat:${slot.id}:${seat.position}`) || undefined
                            }
                            title={seatHint(seat)}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectRow(
                                    seat.player_id
                                        ? { playerId: seat.player_id }
                                        : { slotId: slot.id, seatPosition: seat.position },
                                );
                            }}
                            className={seatRowClass(
                                highlightRows?.has(`seat:${slot.id}:${seat.position}`) ?? false,
                            )}
                        >
                            {seat.player_id
                                ? playerName(seat.player_id)
                                : <span className="text-muted-foreground/60">—</span>}
                        </li>
                    ))}
                </ul>
            )}

            {standings.length > 0 && (
                <div>
                    {slot.matches.length > 0 && (
                        <h4 className="text-xs text-muted-foreground mb-1">Партий: {slot.matches.length}</h4>
                    )}
                    <ul className="space-y-0.5">
                        {standings.map((st) => (
                            <li
                                key={st.player_id}
                                data-bracket-standing={st.place}
                                data-highlighted={
                                    highlightRows?.has(`place:${slot.id}:${st.place}`) || undefined
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectRow({ playerId: st.player_id });
                                }}
                                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1 -mx-1 text-sm transition-colors hover:bg-muted/60 ${
                                    highlightRows?.has(`place:${slot.id}:${st.place}`)
                                        ? "bg-primary/10 ring-1 ring-primary/40"
                                        : ""
                                } ${st.promoted ? "font-semibold" : ""}`}
                            >
                                <RankIcon rank={st.place} className="inline-block h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">{playerName(st.player_id)}</span>
                                <span className={`ml-auto shrink-0 tabular-nums ${st.promoted ? "" : "text-muted-foreground"}`}>
                                    {st.points > 0 ? `+${st.points}` : st.points}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {standings.length === 0 && slot.matches.length > 0 && (
                <p className="text-xs text-muted-foreground">Партий: {slot.matches.length}</p>
            )}

            {slot.ruling_player_ids != null && slot.ruling_player_ids.length > 0 && (
                <p className="text-xs text-muted-foreground break-words">
                    Решение организатора: {slot.ruling_player_ids.map(playerName).join(", ")}
                </p>
            )}
        </div>
    );
}

function slotBadgeVariant(status: BracketSlot["status"]): "default" | "secondary" | "outline" {
    switch (status) {
        case "waiting": return "outline";
        case "playing": return "default";
        case "completed": return "secondary";
    }
}
