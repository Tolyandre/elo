"use client";

import { useEffect, useState } from "react";
import type { BracketSlot, Tournament } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { attachTournamentSlotMatchPromise, getMatchesPagePromise } from "@/app/api";
import { ConfirmDialogWithContent } from "@/components/confirm-dialog";
import { formatDateTime } from "@/lib/datetime";

/**
 * Attach of an existing unlinked match to a playing slot (ADR-26) — repairs
 * a mistakenly unchecked checkbox. Candidates come from the slot's game's
 * recent matches; the server re-verifies the fit.
 */
export function AttachMatchDialog({
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
    const [candidates, setCandidates] = useState<{ id: Base58ID; label: string }[] | null>(null);
    const [pendingId, setPendingId] = useState<Base58ID | null>(null);
    const [error, setError] = useState("");
    // Reset per dialog session (render-phase reset), then fetch candidates.
    const [lastOpen, setLastOpen] = useState(false);
    if (open !== lastOpen) {
        setLastOpen(open);
        setCandidates(null);
        setError("");
    }

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const seatIds = slot.seats.map((s) => s.player_id).filter((p): p is Base58ID => p != null);
        getMatchesPagePromise({ game_id: slot.game_id })
            .then((page) => {
                if (cancelled) return;
                const seatSet = new Set<string>(seatIds);
                const fitting = page.items
                    .filter((m) => !m.tournament && m.score && setEquals(Object.keys(m.score), seatSet))
                    .map((m) => ({
                        id: m.id,
                        label: `${m.date ? formatDateTime(m.date) : "без даты"} · ${[...seatSet].map(playerName).join(", ")}`,
                    }));
                setCandidates(fitting);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, slot.id]);

    const attach = async (matchId: Base58ID) => {
        setPendingId(matchId);
        setError("");
        try {
            await attachTournamentSlotMatchPromise(t.id, slot.id, matchId);
            onOpenChange(false);
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setPendingId(null);
        }
    };

    return (
        <ConfirmDialogWithContent
            open={open}
            onOpenChange={onOpenChange}
            title={`Прикрепить партию — стол ${slot.position}`}
            description="Подходящие партии: та же игра и ровно тот же состав игроков, не учтённые в сетке."
            confirmText="Закрыть"
            cancelText="Закрыть"
            onConfirm={() => onOpenChange(false)}
        >
            <div className="space-y-2 max-h-72 overflow-y-auto">
                {error && <div className="text-red-600 text-sm">{error}</div>}
                {candidates == null && <p className="text-sm text-muted-foreground">Загрузка…</p>}
                {candidates != null && candidates.length === 0 && (
                    <p className="text-sm text-muted-foreground">Подходящих партий нет.</p>
                )}
                {candidates != null && candidates.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        className="w-full text-left text-sm border rounded px-2 py-1.5 hover:bg-accent disabled:opacity-50"
                        disabled={pendingId != null}
                        onClick={() => attach(c.id)}
                    >
                        {pendingId === c.id ? "Прикрепление…" : c.label}
                    </button>
                ))}
            </div>
        </ConfirmDialogWithContent>
    );
}

function setEquals(a: string[], b: Set<string>): boolean {
    if (a.length !== b.size) return false;
    return a.every((x) => b.has(x));
}
