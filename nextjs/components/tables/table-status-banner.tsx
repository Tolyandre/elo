"use client";

import { WifiOff } from "lucide-react";

type Props = {
    /** SSE stream state; when down, the data on screen may be stale. */
    connected: boolean;
};

/**
 * Live-table status banner: a muted "no connection" hint while the SSE
 * stream is down. The page shows the last known state — nothing is lost,
 * and the stream resyncs on its own when the connection returns.
 */
export function TableStatusBanner({ connected }: Props) {
    if (connected) return null;
    return (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            Нет соединения с сервером — показано последнее состояние
        </p>
    );
}
