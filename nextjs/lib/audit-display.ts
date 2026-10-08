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
    tag: "тег",
    arena: "арену",
    tournament: "турнир",
    tenant: "сообщество",
    user: "пользователя",
};

/** One row of the expanded match-edit diff. */
export type MatchUpdateRow =
    | { kind: "date"; old: Date; new: Date }
    | { kind: "game"; oldGameId: Base58ID; newGameId: Base58ID }
    | { kind: "player"; playerId: Base58ID; change: "added" | "removed" | "score"; oldScore?: number | null; newScore?: number | null }
    | { kind: "calculator" };

/** One row of the expanded tenant-settings diff (ADR-36). */
export type TenantUpdateRow =
    | { kind: "membership-mode"; old: string; new: string }
    | { kind: "tournaments-openness"; old: string; new: string }
    | { kind: "starting-rating"; old: number; new: number }
    | { kind: "leagues" }
    | { kind: "icon"; old: string | null; new: string | null }
    | { kind: "clubs"; added: Base58ID[]; removed: Base58ID[] };

/** Looks up the current display name of an audited entity; undefined when it
 * cannot be resolved client-side (deleted entity, no app-wide list). */
export type AuditNameResolver = (entityType: AuditEntityType, entityId: string) => string | undefined;

/**
 * Collapsed-row summary, e.g. "создал игру «Skull King»". The entity name is
 * resolved via entity_id (current name, even for historical rows) with the
 * details document (created/deleted events) as fallback; rows whose name
 * cannot be resolved render the plain entity id next to the summary instead
 * (see auditEntityName). Match rows never carry a name.
 */
export function auditSummary(entry: AuditEntry, resolveName?: AuditNameResolver): string {
    const suffix = nameSuffix(entry, resolveName);
    switch (entry.action) {
        case "created":
            if (entry.entity_type === "match") return "добавил партию";
            return `создал ${ENTITY_NOUN[entry.entity_type]}${suffix}`;
        case "updated":
            return `изменил ${ENTITY_NOUN[entry.entity_type]}${suffix}`;
        case "renamed":
            return `переименовал ${ENTITY_NOUN[entry.entity_type]}${suffix}`;
        case "deleted":
            return `удалил ${ENTITY_NOUN[entry.entity_type]}${suffix}`;
    }
}

/**
 * The entity's display name for an audit row: the context-resolved current
 * name, else the at-event-time name from the details document (what
 * created/deleted rows showed before resolution existed). undefined means
 * nothing resolvable — the row shows the plain entity_id (except match rows,
 * which have no name anywhere).
 */
export function auditEntityName(entry: AuditEntry, resolveName?: AuditNameResolver): string | undefined {
    if (entry.entity_type === "match") return undefined;
    return resolveName?.(entry.entity_type, entry.entity_id) ?? detailsName(entry);
}

function nameSuffix(entry: AuditEntry, resolveName?: AuditNameResolver): string {
    const name = auditEntityName(entry, resolveName);
    return name ? ` «${name}»` : "";
}

function detailsName(entry: AuditEntry): string | undefined {
    if (entry.details?.kind === "entity") return entry.details.name;
    // Camp arenas (ADR-27): create carries the new name, delete the final one.
    if (entry.details?.kind === "arena-camp-config") {
        const change = entry.details.changes.name;
        const name = entry.action === "deleted" ? change?.from : change?.to;
        return name ?? undefined;
    }
    return undefined;
}

/** Whether the row expands into a details section (chevron affordance). */
export function auditIsExpandable(entry: AuditEntry): boolean {
    return (
        entry.action === "renamed" ||
        (entry.action === "updated" && entry.entity_type === "match") ||
        (entry.action === "updated" && entry.entity_type === "tenant") ||
        (entry.action === "updated" && entry.entity_type === "user")
    );
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

/** Tenant-settings diff as display rows: openness pair, arena settings, icon, clubs. */
export function tenantUpdateRows(changes: {
    arena_membership_mode?: { from: string; to: string } | null;
    tournaments_openness?: { from: string; to: string } | null;
    starting_rating?: { from: number; to: number } | null;
    leagues_changed?: boolean;
    icon?: { from: string | null; to: string | null } | null;
    clubs?: { added_club_ids: Base58ID[]; removed_club_ids: Base58ID[] } | null;
}): TenantUpdateRow[] {
    const rows: TenantUpdateRow[] = [];
    if (changes.arena_membership_mode) {
        rows.push({ kind: "membership-mode", old: changes.arena_membership_mode.from, new: changes.arena_membership_mode.to });
    }
    if (changes.tournaments_openness) {
        rows.push({ kind: "tournaments-openness", old: changes.tournaments_openness.from, new: changes.tournaments_openness.to });
    }
    if (changes.starting_rating) {
        rows.push({ kind: "starting-rating", old: changes.starting_rating.from, new: changes.starting_rating.to });
    }
    if (changes.leagues_changed) {
        rows.push({ kind: "leagues" });
    }
    if (changes.icon) {
        rows.push({ kind: "icon", old: changes.icon.from, new: changes.icon.to });
    }
    if (changes.clubs) {
        rows.push({ kind: "clubs", added: changes.clubs.added_club_ids, removed: changes.clubs.removed_club_ids });
    }
    return rows;
}
