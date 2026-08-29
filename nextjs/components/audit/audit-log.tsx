"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, AuditEntityType } from "@/app/api";
import { getAuditPagePromise } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuditEntryRow } from "./audit-entry-row";

/**
 * Audit feed for one entity type (admin tabs) or one entity (match history).
 * Latest first; "Показать ещё" follows the cursor while one is offered.
 */
export function AuditLog({
    entityType,
    entityId,
    emptyText = "Событий пока нет",
    className,
}: {
    entityType: AuditEntityType;
    entityId?: Base58ID;
    emptyText?: string;
    className?: string;
}) {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setLoading(true);
        setError(null);
        getAuditPagePromise({
            entity_type: entityType,
            entity_id: entityId ? String(entityId) : undefined,
        })
            .then((page) => {
                if (cancelled) return;
                setEntries(page.items);
                setNext(page.next);
            })
            .catch(() => {
                if (!cancelled) setError("Не удалось загрузить журнал");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [entityType, entityId]);

    const loadMore = useCallback(async () => {
        if (!next || loadingMore) return;
        setLoadingMore(true);
        try {
            const page = await getAuditPagePromise({ next });
            setEntries((prev) => [...prev, ...page.items]);
            setNext(page.next);
        } catch {
            // toast already shown by the API middleware
        } finally {
            setLoadingMore(false);
        }
    }, [next, loadingMore]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Spinner className="size-4" /> Загрузка…
            </div>
        );
    }
    if (error) return <p className="py-4 text-muted-foreground">{error}</p>;
    if (entries.length === 0) return <p className="py-4 text-muted-foreground">{emptyText}</p>;

    return (
        <div className={className}>
            <div className="divide-y">
                {entries.map((entry) => (
                    <AuditEntryRow key={entry.id} entry={entry} />
                ))}
            </div>
            {next && (
                <div className="mt-4 flex justify-center">
                    <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore && <Spinner className="size-4" />}
                        Показать ещё
                    </Button>
                </div>
            )}
        </div>
    );
}
