import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/app/api";
import { auditEntityName, auditIsExpandable, auditSummary, formatScore, matchUpdateRows, tenantUpdateRows, type AuditNameResolver } from "@/lib/audit-display";
import type { Base58ID } from "@/lib/id";

function entry(partial: Partial<AuditEntry>): AuditEntry {
    return {
        id: "id" as Base58ID,
        created_at: new Date("2026-08-01T12:00:00Z"),
        actor_user_id: "uid" as Base58ID,
        actor_name: "Иван",
        entity_type: "game",
        entity_id: "eid" as Base58ID,
        action: "created",
        details: null,
        ...partial,
    };
}

describe("auditSummary", () => {
    it("uses entity names from created/deleted details", () => {
        expect(auditSummary(entry({ details: { kind: "entity", name: "Skull King" } })))
            .toBe("создал игру «Skull King»");
        expect(auditSummary(entry({ entity_type: "player", action: "deleted", details: { kind: "entity", name: "Аня" } })))
            .toBe("удалил игрока «Аня»");
    });

    it("matches are added, not created", () => {
        expect(auditSummary(entry({ entity_type: "match" }))).toBe("добавил партию");
        expect(auditSummary(entry({ entity_type: "match", action: "updated" }))).toBe("изменил партию");
    });

    it("user permission updates read 'изменил пользователя' and expand to the diff", () => {
        expect(auditSummary(entry({ entity_type: "user", action: "updated" }))).toBe("изменил пользователя");
        expect(auditIsExpandable(entry({ entity_type: "user", action: "updated", details: { kind: "user-update", changes: { schema_version: 1, allow_editing: { from: false, to: true } } } }))).toBe(true);
    });

    it("updates (renames included) expand into the field diff and show the current name", () => {
        const e = entry({ action: "updated", details: { kind: "game-update", changes: { schema_version: 1, name: { from: "Было", to: "Стало" } } } });
        expect(auditIsExpandable(e)).toBe(true);
        expect(auditSummary(e)).toBe("изменил игру");
    });

    it("inlines the context-resolved current name on every action", () => {
        const resolveName: AuditNameResolver = (type, id) => (id === "eid" ? `Имя ${type}` : undefined);
        expect(auditSummary(entry({ entity_type: "tenant", action: "updated" }), resolveName))
            .toBe("изменил сообщество «Имя tenant»");
        expect(auditSummary(entry({ action: "updated", details: { kind: "game-update", changes: { schema_version: 1, name: { from: "Было", to: "Стало" } } } }), resolveName))
            .toBe("изменил игру «Имя game»");
        expect(auditSummary(entry({ entity_type: "player", action: "deleted", details: { kind: "entity", name: "Аня" } }), resolveName))
            .toBe("удалил игрока «Имя player»");
    });

    it("unresolvable names fall back to the details doc, then to the plain id", () => {
        // Deleted entity: the context has no row, the details document still
        // carries the at-event-time name.
        expect(auditSummary(entry({ entity_type: "player", action: "deleted", details: { kind: "entity", name: "Аня" } })))
            .toBe("удалил игрока «Аня»");
        // Nothing resolvable — the row component shows the plain entity_id.
        expect(auditEntityName(entry({ entity_type: "tenant", action: "updated" }))).toBeUndefined();
        expect(auditEntityName(entry({ entity_type: "arena", action: "created" }))).toBeUndefined();
        // Matches never carry a name anywhere.
        expect(auditEntityName(entry({ entity_type: "match" }))).toBeUndefined();
        expect(auditEntityName(entry({ entity_type: "match", details: { kind: "entity", name: "x" } as never }))).toBeUndefined();
    });
});

describe("auditIsExpandable", () => {
    it("expands updates that carry a field diff", () => {
        expect(auditIsExpandable(entry({ action: "created" }))).toBe(false);
        expect(auditIsExpandable(entry({ action: "deleted" }))).toBe(false);
        expect(auditIsExpandable(entry({ entity_type: "match", action: "updated", details: { kind: "match-update", changes: { schema_version: 1, date: null, game: null, player_changes: [], calculator_changed: false } } }))).toBe(true);
        expect(auditIsExpandable(entry({ action: "updated", details: { kind: "player-update", changes: { schema_version: 1, name: { from: "a", to: "b" } } } }))).toBe(true);
        expect(auditIsExpandable(entry({ entity_type: "tenant", action: "updated", details: { kind: "tenant-update", changes: { schema_version: 1, name: null, arena_membership_mode: null, tournaments_openness: null, starting_rating: null, leagues_changed: false, icon: null, clubs: null } } }))).toBe(true);
        // Legacy updated rows with the plain entity shape have no diff to show.
        expect(auditIsExpandable(entry({ action: "updated", details: { kind: "entity", name: "x" } }))).toBe(false);
        expect(auditIsExpandable(entry({ entity_type: "match", action: "updated" }))).toBe(false);
    });
});

describe("matchUpdateRows", () => {
    it("maps every change kind in order date, game, players, calculator", () => {
        const rows = matchUpdateRows({
            date: { old: "2026-08-01T10:00:00Z", new: "2026-08-01T12:00:00Z" },
            game: { old_game_id: "g1" as Base58ID, new_game_id: "g2" as Base58ID },
            player_changes: [
                { player_id: "p1" as Base58ID, change: "score", old_score: 3, new_score: 4 },
                { player_id: "p2" as Base58ID, change: "added", new_score: 7 },
                { player_id: "p3" as Base58ID, change: "removed", old_score: 1 },
            ],
            calculator_changed: true,
        });
        expect(rows.map((r) => r.kind)).toEqual(["date", "game", "player", "player", "player", "calculator"]);
        expect(rows[0]).toMatchObject({
            kind: "date",
            old: new Date("2026-08-01T10:00:00Z"),
            new: new Date("2026-08-01T12:00:00Z"),
        });
        expect(rows[2]).toMatchObject({ change: "score", oldScore: 3, newScore: 4 });
        expect(rows[3]).toMatchObject({ change: "added", newScore: 7 });
        expect(rows[4]).toMatchObject({ change: "removed", oldScore: 1 });
    });

    it("returns an empty diff untouched by optional fields", () => {
        expect(matchUpdateRows({ player_changes: [], calculator_changed: false })).toEqual([]);
    });
});

describe("formatScore", () => {
    it("renders numbers and a dash for missing values", () => {
        expect(formatScore(3.5)).toBe("3.5");
        expect(formatScore(null)).toBe("—");
        expect(formatScore(undefined)).toBe("—");
    });
});

describe("tenantUpdateRows", () => {
    it("maps the name row first, then every changed field", () => {
        const rows = tenantUpdateRows({
            name: { from: "Было", to: "Стало" },
            arena_membership_mode: { from: "any_member", to: "members_only" },
            tournaments_openness: { from: "open", to: "members_only" },
            starting_rating: { from: 500, to: 100 },
            leagues_changed: true,
            clubs: { added_club_ids: ["c1" as Base58ID], removed_club_ids: ["c2" as Base58ID, "c3" as Base58ID] },
        });
        expect(rows.map((r) => r.kind)).toEqual([
            "name",
            "membership-mode",
            "tournaments-openness",
            "starting-rating",
            "leagues",
            "clubs",
        ]);
        expect(rows[1]).toEqual({ kind: "membership-mode", old: "any_member", new: "members_only" });
        expect(rows[3]).toEqual({ kind: "starting-rating", old: 500, new: 100 });
        expect(rows[5]).toEqual({ kind: "clubs", added: ["c1"], removed: ["c2", "c3"] });
    });

    it("skips untouched fields", () => {
        expect(tenantUpdateRows({ starting_rating: { from: 500, to: 100 } })).toEqual([
            { kind: "starting-rating", old: 500, new: 100 },
        ]);
        expect(tenantUpdateRows({})).toEqual([]);
    });
});

describe("auditIsExpandable for tenants", () => {
    it("expands tenant settings updates", () => {
        expect(auditIsExpandable(entry({ entity_type: "tenant", action: "updated", details: { kind: "tenant-update", changes: { schema_version: 1, name: null, arena_membership_mode: null, tournaments_openness: null, starting_rating: null, leagues_changed: false, icon: null, clubs: null } } }))).toBe(true);
        expect(auditIsExpandable(entry({ entity_type: "tenant", action: "created" }))).toBe(false);
    });
});
