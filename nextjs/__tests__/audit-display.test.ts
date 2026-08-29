import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/app/api";
import { auditIsExpandable, auditSummary, formatScore, matchUpdateRows } from "@/lib/audit-display";
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

    it("renames keep the old→new pair for the expanded section", () => {
        const e = entry({ action: "renamed", details: { kind: "rename", oldName: "Было", newName: "Стало" } });
        expect(auditSummary(e)).toBe("переименовал игру");
        expect(auditIsExpandable(e)).toBe(true);
    });
});

describe("auditIsExpandable", () => {
    it("expands only renames and match edits", () => {
        expect(auditIsExpandable(entry({ action: "created" }))).toBe(false);
        expect(auditIsExpandable(entry({ action: "deleted" }))).toBe(false);
        expect(auditIsExpandable(entry({ action: "renamed", details: { kind: "rename", oldName: "a", newName: "b" } }))).toBe(true);
        expect(auditIsExpandable(entry({ entity_type: "match", action: "updated" }))).toBe(true);
        // A non-match "updated" never occurs today, but must not claim expandability.
        expect(auditIsExpandable(entry({ action: "updated" }))).toBe(false);
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
