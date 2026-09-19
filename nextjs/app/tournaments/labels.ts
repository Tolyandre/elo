import type { PlanRound, Tournament, TournamentPlan } from "@/app/api";

// Derived display names (ADR-26: round names are derived client-side from
// track + index; no label is ever stored).

export function tournamentStatusLabel(status: Tournament["status"]): string {
    switch (status) {
        case "registration": return "Регистрация";
        case "running": return "Идёт";
        case "completed": return "Завершён";
        case "cancelled": return "Отменён";
    }
}

export function eliminationLabel(elimination: Tournament["elimination"]): string {
    return elimination === "double" ? "Двойное выбывание (WB + LB)" : "Одиночное выбывание";
}

/** Column header for a bracket track. */
export function trackLabel(track: PlanRound["track"]): string {
    switch (track) {
        case "winners": return "Победители";
        case "losers": return "Проигравшие";
        case "final": return "Финал";
    }
}

/**
 * Round title, shown as the bracket column header. In the double-elim case
 * each round names its track («Верх», «Низ»); single-elimination rounds are
 * just numbered.
 */
export function roundTitle(
    track: PlanRound["track"],
    index: number,
    elimination: Tournament["elimination"] = "single",
): string {
    if (track === "final") return "Финал";
    if (elimination === "double") return track === "winners" ? `Верх ${index}` : `Низ ${index}`;
    return `Тур ${index}`;
}

export function slotStatusLabel(status: "waiting" | "playing" | "completed"): string {
    switch (status) {
        case "waiting": return "Ожидает";
        case "playing": return "Играет";
        case "completed": return "Завершён";
    }
}

/** Chip label for a plan's total round count: «1 тур», «3 тура», «5 туров». */
export function roundsLabel(count: number): string {
    if (count === 1) return "1 тур";
    const mod10 = count % 10;
    const mod100 = count % 100;
    const plural = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "тура" : "туров";
    return `${count} ${plural}`;
}

/** Provenance of an unresolved seat: «из стола 2, место 1». */
export function seatSourceLabel(sourceSlotPosition: number, sourcePlace?: number | null): string {
    return sourcePlace != null
        ? `из стола ${sourceSlotPosition}, место ${sourcePlace}`
        : `из стола ${sourceSlotPosition}`;
}

/**
 * Compact round-by-round plan preview for the shape picker, e.g.
 * «Тур 1: 4+4 → 2; Финал: 4 → 1» (single) — in the double-elim case the
 * tracks interleave, so each round names its track («Верх», «Низ»).
 */
export function planPreview(plan: TournamentPlan): string {
    return plan.rounds
        .map((round) => {
            const byes = round.slots.reduce(
                (n, s) => n + s.seats.filter((seat) => seat.kind === "bye").length, 0);
            const shape = round.slots.map((s) => s.seat_count).join("+") + (byes > 0 ? `+${byes} бай` : "");
            return `${roundTitle(round.track, round.index, plan.elimination)}: ${shape} → ${round.promote}`;
        })
        .join("; ");
}
