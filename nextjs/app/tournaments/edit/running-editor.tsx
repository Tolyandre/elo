"use client";

import { useState } from "react";
import Link from "next/link";
import type { Bracket, BracketSlot, Tournament } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import {
    adjustTournamentSlotPromise,
    detachTournamentSlotMatchPromise,
    setTournamentSlotRulingPromise,
} from "@/app/api";
import { useGames } from "@/app/gamesContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { roundTitle } from "../labels";
import { useConfirmAction, ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RulingDialog } from "./ruling-dialog";
import { AttachMatchDialog } from "./attach-match-dialog";

/**
 * Running-state organizer tools (ADR-26 §UI): per slot — game reassignment
 * (while no match is linked), detach, the ruling dialog and attach of a
 * mistakenly-unchecked match.
 */
export function RunningEditor({
    tournament: t,
    bracket,
    invalidate,
}: {
    tournament: Tournament;
    bracket: Bracket;
    invalidate: () => void;
}) {
    return (
        <div className="space-y-4">
            {bracket.rounds.map((round) => (
                <div key={`${round.track}-${round.index}`} className="space-y-2">
                    <h2 className="font-semibold">{roundTitle(round.track, round.index, t.elimination)}</h2>
                    {round.slots.map((slot) => (
                        <SlotEditor
                            key={slot.id}
                            tournament={t}
                            slot={slot}
                            invalidate={invalidate}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

function SlotEditor({
    tournament: t,
    slot,
    invalidate,
}: {
    tournament: Tournament;
    slot: BracketSlot;
    invalidate: () => void;
}) {
    const { games } = useGames();
    const { playerMap, playerDisplayName } = usePlayers();
    const [busy, setBusy] = useState(false);
    const [rulingOpen, setRulingOpen] = useState(false);
    const [attachOpen, setAttachOpen] = useState(false);
    const [error, setError] = useState("");
    const detach = useConfirmAction(async (matchId: Base58ID) => {
        await detachTournamentSlotMatchPromise(t.id, slot.id, matchId);
        invalidate();
    });
    const cancelRuling = useConfirmAction(async () => {
        await setTournamentSlotRulingPromise(t.id, slot.id, []);
        invalidate();
    });

    const playerName = (pid: string): string => {
        const player = playerMap.get(pid);
        return player ? playerDisplayName(player) : pid;
    };

    const noMatches = slot.matches.length === 0;
    const adjustableGame = noMatches;

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await fn();
            invalidate();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Стол {slot.position}</span>
                <span className="text-xs text-muted-foreground">promote: {slot.promote}</span>
            </div>

            {adjustableGame ? (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Игра:</span>
                    <Select
                        value={slot.game_id}
                        onValueChange={(v) => run(() => adjustTournamentSlotPromise(t.id, slot.id, { game_id: v as Base58ID }))}
                        disabled={busy}
                    >
                        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {games.map((g) => (
                                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Игра: {games.find((g) => g.id === slot.game_id)?.name ?? "—"}
                </p>
            )}
            {error && <p className="text-red-600 text-sm">{error}</p>}

            {slot.ruling_player_ids != null && slot.ruling_player_ids.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-muted px-2 py-1">
                    <p className="text-xs min-w-0 flex-1 basis-52 break-words">
                        Решение организатора: {slot.ruling_player_ids.map(playerName).join(", ")}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0"
                        disabled={busy}
                        onClick={() => cancelRuling.trigger(null)}
                    >
                        Отменить решение
                    </Button>
                </div>
            )}

            <div className="space-y-1">
                {slot.matches.map((m) => (
                    <div key={m.match_id} className="flex items-center gap-2 text-sm">
                        <Link href={`/matches/view?id=${m.match_id}`} className="underline min-w-0 truncate">
                            Партия {m.match_id}
                        </Link>
                        <button
                            type="button"
                            className="text-red-600 text-sm px-1 shrink-0"
                            aria-label="Открепить партию"
                            onClick={() => detach.trigger(m.match_id)}
                        >
                            ✕
                        </button>
                    </div>
                ))}
                {slot.matches.length === 0 && (
                    <p className="text-xs text-muted-foreground">Партий пока нет</p>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {(slot.status === "playing" || slot.status === "completed") && (
                    <Button variant="outline" size="sm" onClick={() => setRulingOpen(true)}>
                        Решение организатора
                    </Button>
                )}
                {slot.status === "playing" && (
                    <Button variant="outline" size="sm" onClick={() => setAttachOpen(true)}>
                        Прикрепить партию
                    </Button>
                )}
            </div>

            <RulingDialog
                tournament={t}
                slot={slot}
                open={rulingOpen}
                onOpenChange={setRulingOpen}
                onDone={invalidate}
                playerName={playerName}
            />
            <AttachMatchDialog
                tournament={t}
                slot={slot}
                open={attachOpen}
                onOpenChange={setAttachOpen}
                onDone={invalidate}
                playerName={playerName}
            />

            <ConfirmDialog
                open={detach.open}
                onOpenChange={detach.onOpenChange}
                title="Открепить партию?"
                description="Партия выйдет из сетки турнира; результаты стола пересчитаются. Если партии следующего тура уже сыграны, открепить не получится — сначала разберите их."
                confirmText="Открепить"
                confirmVariant="destructive"
                loading={detach.pending}
                onConfirm={detach.confirm}
            />
            <ConfirmDialog
                open={cancelRuling.open}
                onOpenChange={cancelRuling.onOpenChange}
                title="Отменить решение организатора?"
                description="Если партии следующего тура уже сыграны, отменить не получится — сначала разберите их."
                confirmText="Отменить решение"
                loading={cancelRuling.pending}
                onConfirm={cancelRuling.confirm}
            />
        </div>
    );
}
