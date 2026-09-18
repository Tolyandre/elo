"use client";

import { useMemo } from "react";
import type { Bracket, BracketSlot } from "@/app/api";
import { usePlayers } from "@/app/players/PlayersContext";
import { useGames } from "@/app/gamesContext";
import { roundTitle, slotStatusLabel, trackLabel } from "../labels";
import { Badge } from "@/components/ui/badge";
import { RankIcon } from "@/components/rank-icon";

/**
 * The bracket (ADR-26 §UI): a pure rendering of the GET /bracket DTO —
 * columns per track in plan order, each slot as a card with seats, live
 * standings and the linked match count. No client-side bracket logic.
 */
export function BracketView({ bracket }: { bracket: Bracket }) {
    const tracks = useMemo(() => groupByTrack(bracket.rounds), [bracket.rounds]);
    // Seat provenance («из стола N») resolves the source slot's table number.
    const slotPositions = useMemo(() => {
        const map = new Map<string, number>();
        for (const round of bracket.rounds) {
            for (const slot of round.slots) map.set(slot.id, slot.position);
        }
        return map;
    }, [bracket.rounds]);

    return (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {tracks.map(({ track, rounds }) => (
                <div key={track} className="min-w-64 flex-1 space-y-3">
                    <h2 className="font-semibold">{trackLabel(track)}</h2>
                    {rounds.map((round) => (
                        <div key={`${round.track}-${round.index}`} className="space-y-2">
                            {rounds.length > 1 && (
                                <h3 className="text-sm text-muted-foreground">{roundTitle(round.track, round.index)}</h3>
                            )}
                            {round.slots.map((slot) => (
                                <SlotCard key={slot.id} slot={slot} slotPositions={slotPositions} />
                            ))}
                        </div>
                    ))}
                </div>
            ))}
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

    return (
        <div className="rounded-xl border bg-card text-card-foreground p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium min-w-0 truncate">
                    Стол {slot.position}
                    {gameName && <span className="text-muted-foreground"> · {gameName}</span>}
                </span>
                <Badge variant={slotBadgeVariant(slot.status)} className="shrink-0 whitespace-nowrap">
                    {slotStatusLabel(slot.status)}
                </Badge>
            </div>

            <ul className="space-y-1">
                {[...slot.seats].sort((a, b) => a.position - b.position).map((seat) => (
                    <li key={seat.position} className="text-sm">
                        {seat.player_id
                            ? playerName(seat.player_id)
                            : seat.source_slot_id && slotPositions.has(seat.source_slot_id)
                                ? <span className="text-muted-foreground">
                                    {`из стола ${slotPositions.get(seat.source_slot_id)}`}
                                    {seat.source_place != null ? `, место ${seat.source_place}` : ""}
                                </span>
                                : <span className="text-muted-foreground">участник не определён</span>}
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
                            <li key={st.player_id} className={`flex items-center gap-1.5 text-sm ${st.promoted ? "font-semibold" : ""}`}>
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

/** Rounds grouped into consecutive track sections; the DTO is in canonical track order. */
function groupByTrack(rounds: Bracket["rounds"]) {
    const tracks: { track: Bracket["rounds"][number]["track"]; rounds: Bracket["rounds"] }[] = [];
    for (const round of rounds) {
        const last = tracks[tracks.length - 1];
        if (last && last.track === round.track) {
            last.rounds.push(round);
        } else {
            tracks.push({ track: round.track, rounds: [round] });
        }
    }
    return tracks;
}
