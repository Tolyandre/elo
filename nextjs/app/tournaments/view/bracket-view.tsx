"use client";

import { useMemo, useRef } from "react";
import type { Bracket, BracketRound, BracketSeat, BracketSlot } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { roundTitle, seatSourceLabel, slotStatusLabel, trackLabel } from "../labels";
import { groupByTrack } from "../bracket-structure";
import { ConnectorLayer, useConnectorPaths, type ConnectorSpec } from "@/components/bracket/bracket-connector";
import { Badge } from "@/components/ui/badge";
import { RankIcon } from "@/components/rank-icon";

/**
 * The bracket (ADR-26 §UI): a pure rendering of the GET /bracket DTO —
 * a column per round grouped into stacked track bands (Победители over
 * Проигравшие, the grand final to the right of both), with promotion lines
 * drawn from each seat's source slot. No client-side bracket logic.
 */
export function BracketView({ bracket }: { bracket: Bracket }) {
    const contentRef = useRef<HTMLDivElement>(null);

    const bands = useMemo(() => groupByTrack(bracket.rounds), [bracket.rounds]);
    const finalBand = bands.find((b) => b.track === "final");
    const trackBands = bands.filter((b) => b.track !== "final");

    // Seat provenance («из стола N») resolves the source slot's table number.
    const slotPositions = useMemo(() => {
        const map = new Map<string, number>();
        for (const round of bracket.rounds) {
            for (const slot of round.slots) map.set(slot.id, slot.position);
        }
        return map;
    }, [bracket.rounds]);

    // One connector per seat with a known source slot: the line the promoted
    // player (or the pending place) travels along.
    const connections = useMemo<ConnectorSpec[]>(() => {
        const specs: ConnectorSpec[] = [];
        for (const round of bracket.rounds) {
            for (const slot of round.slots) {
                for (const seat of slot.seats) {
                    if (!seat.source_slot_id) continue;
                    specs.push({
                        key: `${slot.id}:${seat.position}`,
                        from: { slotId: seat.source_slot_id, place: seat.source_place ?? undefined },
                        to: { slotId: slot.id, seatPosition: seat.position },
                        resolved: seat.player_id != null,
                    });
                }
            }
        }
        return specs;
    }, [bracket.rounds]);

    const paths = useConnectorPaths(contentRef, connections);

    return (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
            <div ref={contentRef} className="relative flex min-w-max items-stretch gap-8">
                <ConnectorLayer paths={paths} />
                <div className="flex flex-col gap-8">
                    {trackBands.map(({ track, rounds }) => (
                        <section key={track} className="flex flex-col gap-2">
                            {trackBands.length > 1 && (
                                <h2 className="text-sm font-semibold text-muted-foreground">{trackLabel(track)}</h2>
                            )}
                            <div className="flex flex-1 items-stretch gap-8">
                                {rounds.map((round) => (
                                    <RoundColumn
                                        key={`${round.track}-${round.index}`}
                                        round={round}
                                        elimination={bracket.elimination}
                                        slotPositions={slotPositions}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
                {finalBand && (
                    <section className="flex flex-col gap-2">
                        <div className="flex flex-1 items-stretch gap-8">
                            {finalBand.rounds.map((round) => (
                                <RoundColumn
                                    key={`${round.track}-${round.index}`}
                                    round={round}
                                    elimination={bracket.elimination}
                                    slotPositions={slotPositions}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function RoundColumn({
    round,
    elimination,
    slotPositions,
}: {
    round: BracketRound;
    elimination: Bracket["elimination"];
    slotPositions: Map<string, number>;
}) {
    return (
        <div className="flex w-56 flex-col">
            <h3 className="mb-2 text-center text-sm font-medium text-muted-foreground">
                {roundTitle(round.track, round.index, elimination)}
            </h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
                {round.slots.map((slot) => (
                    <SlotCard key={slot.id} slot={slot} slotPositions={slotPositions} />
                ))}
            </div>
        </div>
    );
}

function SlotCard({ slot, slotPositions }: { slot: BracketSlot; slotPositions: Map<string, number> }) {
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

    return (
        <div data-bracket-slot={slot.id} className="rounded-xl border bg-card text-card-foreground p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium min-w-0 truncate">
                    Стол {slot.position}
                </span>
                <Badge variant={slotBadgeVariant(slot.status)} className="shrink-0 whitespace-nowrap">
                    {slotStatusLabel(slot.status)}
                </Badge>
            </div>
            {gameName && <p className="text-xs text-muted-foreground truncate">{gameName}</p>}

            <ul className="space-y-1">
                {[...slot.seats].sort((a, b) => a.position - b.position).map((seat) => (
                    <li
                        key={seat.position}
                        data-bracket-seat={seat.position}
                        title={seatHint(seat)}
                        className="text-sm truncate"
                    >
                        {seat.player_id
                            ? playerName(seat.player_id)
                            : <span className="text-muted-foreground/60">—</span>}
                    </li>
                ))}
            </ul>

            {standings.length > 0 && (
                <div>
                    <h4 className="text-xs text-muted-foreground mb-1">
                        Положение{slot.matches.length > 0 && ` · партий: ${slot.matches.length}`}
                    </h4>
                    <ul className="space-y-0.5">
                        {standings.map((st) => (
                            <li
                                key={st.player_id}
                                data-bracket-standing={st.place}
                                className={`flex items-center gap-1.5 text-sm ${st.promoted ? "font-semibold" : ""}`}
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
