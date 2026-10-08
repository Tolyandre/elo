// The audit log (ADR-14): the paginated feed and the details-document mapper
// that narrows the opaque details union by structural markers.
import { client, unwrap } from "./client";
import type { components } from "../api-types.gen";
import type { Base58ID } from "@/lib/id";

export type AuditEntityType = "match" | "game" | "player" | "club" | "tag" | "arena" | "tournament" | "tenant" | "user";
export type AuditAction = "created" | "updated" | "renamed" | "deleted";

/** Details narrowed into a discriminated union by action/entity_type. */
export type AuditEntryDetails =
    | { kind: "entity"; name: string }
    | { kind: "rename"; oldName: string; newName: string }
    | { kind: "match-update"; changes: components["schemas"]["AuditMatchUpdateDetails"] }
    | { kind: "tenant-update"; changes: components["schemas"]["AuditTenantUpdateDetails"] }
    | { kind: "user-update"; changes: components["schemas"]["AuditUserUpdateDetails"] }
    | { kind: "club-update"; changes: components["schemas"]["AuditClubUpdateDetails"] }
    | { kind: "arena-camp-config"; changes: components["schemas"]["AuditArenaCampConfigDetails"] }
    | { kind: "camp-link"; op: string; matchId: string }
    | { kind: "tournament-config"; changes: components["schemas"]["AuditTournamentConfigDetails"] }
    | { kind: "tournament-start"; changes: components["schemas"]["AuditTournamentStartDetails"] }
    | { kind: "tournament-state"; changes: components["schemas"]["AuditTournamentStateDetails"] }
    | { kind: "slot-ruling"; changes: components["schemas"]["AuditSlotRulingDetails"] }
    | { kind: "slot-link"; changes: components["schemas"]["AuditSlotLinkDetails"] };

export type AuditEntry = {
    id: Base58ID;
    created_at: Date;
    /** Null for system events (the grand-final-deadline auto-cancel, ADR-26). */
    actor_user_id: Base58ID | null;
    actor_name: string | null;
    entity_type: AuditEntityType;
    entity_id: Base58ID;
    action: AuditAction;
    details: AuditEntryDetails | null;
};

export type AuditPage = {
    items: AuditEntry[];
    next: string | null;
};

function mapAuditEntry(e: components["schemas"]["AuditEntry"]): AuditEntry {
    let details: AuditEntryDetails | null = null;
    if (e.details) {
        if (e.action === "renamed" && "old_name" in e.details) {
            details = { kind: "rename", oldName: e.details.old_name, newName: e.details.new_name };
        } else if (e.action === "updated" && "player_changes" in e.details) {
            details = { kind: "match-update", changes: e.details };
        } else if (e.action === "updated" && "leagues_changed" in e.details) {
            details = { kind: "tenant-update", changes: e.details };
        } else if (e.action === "updated" && "allow_editing" in e.details) {
            details = { kind: "user-update", changes: e.details };
        } else if (e.action === "updated" && "players_changed" in e.details) {
            details = { kind: "club-update", changes: e.details };
        } else if ("origin_kind" in e.details) {
            details = { kind: "slot-link", changes: e.details as components["schemas"]["AuditSlotLinkDetails"] };
        } else if ("before_player_ids" in e.details || "after_player_ids" in e.details) {
            details = { kind: "slot-ruling", changes: e.details as components["schemas"]["AuditSlotRulingDetails"] };
        } else if ("reason" in e.details && "from" in e.details) {
            details = { kind: "tournament-state", changes: e.details as components["schemas"]["AuditTournamentStateDetails"] };
        } else if ("plan" in e.details && "seed" in e.details) {
            details = { kind: "tournament-start", changes: e.details as components["schemas"]["AuditTournamentStartDetails"] };
        } else if ("games" in e.details || "from_player_ids" in e.details || "to_player_ids" in e.details) {
            details = { kind: "tournament-config", changes: e.details as components["schemas"]["AuditTournamentConfigDetails"] };
        } else if ("op" in e.details) {
            const d = e.details as components["schemas"]["AuditCampLinkDetails"];
            details = { kind: "camp-link", op: d.op, matchId: d.match_id };
        } else if ("starts_at" in e.details || "ends_at" in e.details) {
            details = { kind: "arena-camp-config", changes: e.details as components["schemas"]["AuditArenaCampConfigDetails"] };
        } else if ("name" in e.details && typeof e.details.name === "string") {
            details = { kind: "entity", name: e.details.name };
        }
    }
    return {
        id: e.id,
        created_at: new Date(e.created_at),
        actor_user_id: e.actor_user_id ?? null,
        actor_name: e.actor_name ?? null,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        action: e.action,
        details,
    };
}

export async function getAuditPagePromise(params?: {
    entity_type?: AuditEntityType | AuditEntityType[];
    entity_id?: string;
    next?: string;
    limit?: number;
}): Promise<AuditPage> {
    // openapi-fetch serializes array values as repeated query keys
    // (?entity_type=game&entity_type=tag), which the API binds to a list.
    const query: Record<string, string | string[]> = {};
    if (params?.next) {
        // The cursor token embeds the filters; only limit is repeated.
        query.next = params.next;
    } else {
        if (params?.entity_type) query.entity_type = params.entity_type;
        if (params?.entity_id) query.entity_id = params.entity_id;
    }
    if (params?.limit) query.limit = String(params.limit);
    const data = await unwrap(client.GET("/audit", { params: { query } }));
    return {
        items: data.data.map(mapAuditEntry),
        next: data.next ?? null,
    };
}
