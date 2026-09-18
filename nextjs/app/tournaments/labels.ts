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

/** Round title inside its track column; the column header disambiguates tracks. */
export function roundTitle(track: PlanRound["track"], index: number): string {
    return track === "final" ? "Финал" : `Тур ${index}`;
}

export function slotStatusLabel(status: "waiting" | "playing" | "completed"): string {
    switch (status) {
        case "waiting": return "Ожидает";
        case "playing": return "Играет";
        case "completed": return "Завершён";
    }
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
    const roundName = (round: PlanRound): string => {
        if (round.track === "final") return "Финал";
        if (plan.elimination === "double") return round.track === "winners" ? `Верх ${round.index}` : `Низ ${round.index}`;
        return `Тур ${round.index}`;
    };
    return plan.rounds
        .map((round) => {
            const byes = round.slots.reduce(
                (n, s) => n + s.seats.filter((seat) => seat.kind === "bye").length, 0);
            const shape = round.slots.map((s) => s.seat_count).join("+") + (byes > 0 ? `+${byes} бай` : "");
            return `${roundName(round)}: ${shape} → ${round.promote}`;
        })
        .join("; ");
}
