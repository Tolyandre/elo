// Pure mapping from audit entries to display rows. Kept free of React so it
// is unit-testable (__tests__/audit-display.test.ts).

import type { AuditEntry, AuditEntityType } from "@/app/api";
import type { Base58ID } from "@/lib/id";

// Accusative-case nouns for summary phrases ("создал игру", "удалил игрока").
const ENTITY_NOUN: Record<AuditEntityType, string> = {
    match: "партию",
    game: "игру",
    player: "игрока",
    club: "клуб",
};

/** One row of the expanded match-edit diff. */
export type MatchUpdateRow =
    | { kind: "date"; old: Date; new: Date }
    | { kind: "game"; oldGameId: Base58ID; newGameId: Base58ID }
    | { kind: "player"; playerId: Base58ID; change: "added" | "removed" | "score"; oldScore?: number | null; newScore?: number | null }
    | { kind: "calculator" };

/**
 * Collapsed-row summary, e.g. "создал игру «Skull King»". Entity names known
 * from the details document (created/deleted events) are inlined; renames and
 * match edits show their old→new values in the expanded section instead.
 */
export function auditSummary(entry: AuditEntry): string {
    switch (entry.action) {
        case "created":
            if (entry.entity_type === "match") return "добавил партию";
            return `создал ${ENTITY_NOUN[entry.entity_type]}${entityNameSuffix(entry)}`;
        case "updated":
            return `изменил ${ENTITY_NOUN[entry.entity_type]}`;
        case "renamed":
            return `переименовал ${ENTITY_NOUN[entry.entity_type]}`;
        case "deleted":
            return `удалил ${ENTITY_NOUN[entry.entity_type]}${entityNameSuffix(entry)}`;
    }
}

function entityNameSuffix(entry: AuditEntry): string {
    return entry.details?.kind === "entity" ? ` «${entry.details.name}»` : "";
}

/** Whether the row expands into a details section (chevron affordance). */
export function auditIsExpandable(entry: AuditEntry): boolean {
    return entry.action === "renamed" || (entry.action === "updated" && entry.entity_type === "match");
}

/** Match-edit diff as display rows: date, game, then players, then calculator. */
export function matchUpdateRows(changes: {
    date?: { old: string; new: string } | null;
    game?: { old_game_id: Base58ID; new_game_id: Base58ID } | null;
    player_changes: { player_id: Base58ID; change: "added" | "removed" | "score"; old_score?: number | null; new_score?: number | null }[];
    calculator_changed: boolean;
}): MatchUpdateRow[] {
    const rows: MatchUpdateRow[] = [];
    if (changes.date) {
        rows.push({ kind: "date", old: new Date(changes.date.old), new: new Date(changes.date.new) });
    }
    if (changes.game) {
        rows.push({ kind: "game", oldGameId: changes.game.old_game_id, newGameId: changes.game.new_game_id });
    }
    for (const pc of changes.player_changes) {
        rows.push({ kind: "player", playerId: pc.player_id, change: pc.change, oldScore: pc.old_score, newScore: pc.new_score });
    }
    if (changes.calculator_changed) {
        rows.push({ kind: "calculator" });
    }
    return rows;
}

/** Format a score value for diff rows (null → "—"). */
export function formatScore(value: number | null | undefined): string {
    if (value == null) return "—";
    return String(value);
}
