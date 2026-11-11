"use client";

import Link from "next/link";
import type { PendingOp } from "@/lib/offline/types";
import { PendingSyncBadge } from "@/components/pending-sync-badge";
import { OpChanges } from "@/components/offline/op-card";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SplitSquareHorizontal } from "lucide-react";

/**
 * The «Несохранённые изменения» card the entity view pages show for a queued
 * edit (match, player, game): the status chip, the conflict banner pointing
 * at the /offline queue (resolution stays there — ADR-37: sync never opens
 * merge dialogs) and the audit-style change list. Rendered only while an op
 * exists — it disappears when the sync lands.
 */
export function PendingChangesCard({ op }: { op: PendingOp }) {
    return (
        <Card>
            <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-base font-semibold">Несохранённые изменения</h2>
                    <PendingSyncBadge status={op.status} error={op.error} />
                </div>
                {op.status === "conflict" ? (
                    <Alert variant="destructive">
                        <SplitSquareHorizontal className="h-4 w-4" />
                        <AlertDescription>
                            На сервере с момента редактирования есть изменения — разрешите конфликт в{" "}
                            <Link href="/offline" className="underline">очереди офлайна</Link>.
                        </AlertDescription>
                    </Alert>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Изменения ещё не на сервере — отправятся автоматически.
                    </p>
                )}
                <OpChanges op={op} />
            </CardContent>
        </Card>
    );
}
