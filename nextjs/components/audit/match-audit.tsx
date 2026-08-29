"use client";

import { useEffect, useState } from "react";
import { getAuditPagePromise, type AuditEntry } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { formatDateTime } from "@/lib/datetime";
import { Card, CardContent } from "@/components/ui/card";
import { AuditEntryRow } from "./audit-entry-row";

/**
 * "Кто добавил и кто менял" section on the match view page. The added-by line
 * comes from the "created" audit event — matches recorded before the audit log
 * existed have none, and the whole section is then omitted.
 */
export function MatchAudit({ matchId }: { matchId: Base58ID }) {
    const [entries, setEntries] = useState<AuditEntry[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        getAuditPagePromise({ entity_type: "match", entity_id: String(matchId) })
            .then((page) => {
                if (!cancelled) setEntries(page.items);
            })
            .catch(() => {
                if (!cancelled) setEntries([]);
            });
        return () => {
            cancelled = true;
        };
    }, [matchId]);

    if (!entries || entries.length === 0) return null;

    const created = entries.find((e) => e.action === "created");
    const edits = entries.filter((e) => e.action === "updated");

    return (
        <Card>
            <CardContent className="space-y-2">
                <h2 className="text-base font-semibold">История</h2>
                {created && (
                    <p className="text-sm">
                        <span className="text-muted-foreground">Добавил: </span>
                        <span className="font-medium">{created.actor_name}</span>
                        <span className="text-muted-foreground"> · {formatDateTime(created.created_at)}</span>
                    </p>
                )}
                {edits.length > 0 && (
                    <div className="divide-y">
                        {edits.map((entry) => (
                            <AuditEntryRow key={entry.id} entry={entry} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
