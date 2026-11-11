"use client";

import React from "react";
import Link from "next/link";
import { useOffline } from "@/app/offline/OfflineContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CloudOff, CloudUpload } from "lucide-react";

// Header indicator: visible when offline, when reads are served from the
// cache, or when there are unsynced items. It links to the /offline queue
// page (ADR-37), where the pending items, sync errors and conflict
// resolution live — the icon itself is just an entry point, no popover.
export function SyncStatus() {
    const { pendingCount, errorCount, conflictCount, offline, dataFromCache, isSyncing } = useOffline();

    // Reads falling back to the cache (slow API between pings) get the crossed
    // cloud too — without it the page would look freshly updated while showing
    // cached data. This does not change write behaviour; `offline` still does.
    const staleReads = !offline && dataFromCache;

    if (!offline && !staleReads && pendingCount === 0) return null;

    // Crossed cloud when offline (no network or server down) or when reads come
    // from the cache; upload icon only when reachable but items are still pending.
    const crossedCloud = offline || staleReads;
    const hasProblems = errorCount > 0 || conflictCount > 0;

    return (
        <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-0.5 px-1.5 shrink-0"
            aria-label={pendingCount > 0 ? `Статус сохранения, в очереди: ${pendingCount}` : "Статус сохранения"}
            asChild
        >
            <Link href="/offline">
                {/* The count rides the icon's corner instead of taking its own
                    slot: the nav row is flex-nowrap and a side-by-side badge
                    pushed it past narrow phone viewports. */}
                <span className="relative inline-flex">
                    {isSyncing ? <Spinner className="size-4" /> : crossedCloud ? <CloudOff className="size-4" /> : <CloudUpload className="size-4" />}
                    {pendingCount > 0 && (
                        <Badge
                            variant={hasProblems ? "destructive" : "secondary"}
                            className="absolute -top-1.5 -right-2 h-3.5 min-w-3.5 justify-center px-1 text-[9px] leading-none"
                        >
                            {pendingCount}
                        </Badge>
                    )}
                </span>
            </Link>
        </Button>
    );
}
