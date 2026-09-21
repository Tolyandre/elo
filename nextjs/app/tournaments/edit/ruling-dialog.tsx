"use client";

import { useMemo, useState } from "react";
import type { BracketSlot, Tournament } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { setTournamentSlotRulingPromise } from "@/app/api";
import { ConfirmDialogWithContent } from "@/components/confirm-dialog";

/**
 * The organizer ruling dialog (ADR-26): an ordered promotion set of exactly
 * `promote` seated players — picks happen in click order and replace the
 * slot's outcome (the standings-based result or a prior ruling), recomputing
 * the downstream cascade server-side. While a ruling is in force it is
 * prefilled, so the dialog edits the standing decision.
 */
export function RulingDialog({
    tournament: t,
    slot,
    open,
    onOpenChange,
    onDone,
    playerName,
}: {
    tournament: Tournament;
    slot: BracketSlot;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
    playerName: (pid: string) => string;
}) {
    // Candidate order: the live standings, falling back to the seat order
    // when the slot has no matches yet (a pre-play ruling for an empty table).
    const candidates = useMemo(() => {
        if (slot.standings.length > 0) {
            return [...slot.standings].sort((a, b) => a.place - b.place).map((st) => st.player_id);
        }
        return [...slot.seats]
            .sort((a, b) => a.position - b.position)
            .map((s) => s.player_id)
            .filter((pid): pid is Base58ID => pid != null);
    }, [slot]);

    const [picked, setPicked] = useState<Base58ID[]>([]);
    const [pending, setPending] = useState(false);
    // Reset the picks each time the dialog opens (render-phase reset — the
    // state describes one dialog session); a standing ruling prefills them.
    const [lastOpen, setLastOpen] = useState(false);
    if (open !== lastOpen) {
        setLastOpen(open);
        if (open) setPicked(slot.ruling_player_ids ? [...slot.ruling_player_ids] : []);
    }

    const toggle = (pid: Base58ID) => {
        setPicked((prev) =>
            prev.includes(pid) ? prev.filter((p) => p !== pid) : [...prev, pid],
        );
    };

    const confirm = async () => {
        setPending(true);
        try {
            await setTournamentSlotRulingPromise(t.id, slot.id, picked);
            onOpenChange(false);
            onDone();
        } finally {
            setPending(false);
        }
    };

    return (
        <ConfirmDialogWithContent
            open={open}
            onOpenChange={onOpenChange}
            title={`Решение организатора — стол ${slot.position}`}
            description={`Выберите по порядку ${slot.promote} игрока(ов) для повышения. Порядок выбора = места. Решение заменит текущий результат стола и будет действовать, пока вы его не отмените.`}
            confirmText="Записать решение"
            loading={pending}
            onConfirm={confirm}
        >
            <ul className="space-y-1 max-h-72 overflow-y-auto">
                {candidates.map((pid) => {
                    const idx = picked.indexOf(pid);
                    return (
                        <li key={pid}>
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={idx >= 0}
                                    onChange={() => toggle(pid)}
                                />
                                <span className="min-w-0 truncate">{playerName(pid)}</span>
                                {idx >= 0 && (
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        место {idx + 1}
                                    </span>
                                )}
                            </label>
                        </li>
                    );
                })}
            </ul>
        </ConfirmDialogWithContent>
    );
}
