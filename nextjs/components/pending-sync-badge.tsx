import { Badge } from "@/components/ui/badge";
import { CloudOff, SplitSquareHorizontal } from "lucide-react";
import type { SyncStatus } from "@/lib/offline/types";

/** The queue sync state of any pending item — pending cards, the /offline
 * page's op rows and any surface showing unsynced entities badge alike. */
export function PendingSyncBadge({ status, error }: { status: SyncStatus; error?: string }) {
    if (status === "error") {
        return (
            <Badge variant="destructive">
                <CloudOff />
                ошибка: {error}
            </Badge>
        );
    }
    if (status === "conflict") {
        return (
            <Badge variant="destructive">
                <SplitSquareHorizontal />
                конфликт
            </Badge>
        );
    }
    if (status === "syncing") {
        return (
            <Badge variant="secondary">
                <CloudOff />
                отправляется…
            </Badge>
        );
    }
    return (
        <Badge variant="secondary">
            <CloudOff />
            не сохранено
        </Badge>
    );
}
