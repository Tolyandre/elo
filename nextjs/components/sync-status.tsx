"use client";

import React from "react";
import { useOffline } from "@/app/offline/OfflineContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { LoginLink } from "@/components/login-link";
import { CloudOff, CloudUpload } from "lucide-react";

// Header indicator: visible when offline, when reads are served from the
// cache, or when there are unsynced items.
export function SyncStatus() {
    const {
        pendingMatches,
        pendingPlayers,
        pendingGames,
        pendingCount,
        errorCount,
        offline,
        isOnline,
        apiReachable,
        dataFromCache,
        isSyncing,
        authRequired,
        syncNow,
    } = useOffline();

    // The API is unreachable while online when the self-hosted server is off
    // (used only to pick the right explanation below).
    const apiDown = isOnline && apiReachable === false;
    // Reads falling back to the cache (slow API between pings) get the crossed
    // cloud too — without it the page would look freshly updated while showing
    // cached data. This does not change write behaviour; `offline` still does.
    const staleReads = !offline && dataFromCache;

    if (!offline && !staleReads && pendingCount === 0) return null;

    // Crossed cloud when offline (no network or server down) or when reads come
    // from the cache; upload icon only when reachable but items are still pending.
    const crossedCloud = offline || staleReads;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 gap-0.5 px-1.5 shrink-0" aria-label="Статус сохранения">
                    {isSyncing ? <Spinner className="size-4" /> : crossedCloud ? <CloudOff className="size-4" /> : <CloudUpload className="size-4" />}
                    {pendingCount > 0 && (
                        <Badge
                            variant={errorCount > 0 ? "destructive" : "secondary"}
                            className="h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
                        >
                            {pendingCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
                {!isOnline && (
                    <p className="text-sm">
                        <CloudOff className="inline size-4 mr-1 align-text-bottom" />
                        Нет сети. Вы видите кэшированные данные.
                    </p>
                )}
                {apiDown && (
                    <p className="text-sm">
                        <CloudOff className="inline size-4 mr-1 align-text-bottom" />
                        Сервер API недоступен.<br/>
                        Вы видите кэшированные данные.
                    </p>
                )}
                {staleReads && (
                    <p className="text-sm">
                        <CloudOff className="inline size-4 mr-1 align-text-bottom" />
                        Медленное соединение — данные загружены из кэша и могут быть устаревшими.
                    </p>
                )}
                {pendingCount > 0 && (
                    <div className="text-sm space-y-1">
                        <p className="font-medium">Ожидают отправки:</p>
                        <ul className="text-muted-foreground">
                            {pendingMatches.length > 0 && <li>партий: {pendingMatches.length}</li>}
                            {pendingPlayers.length > 0 && <li>игроков: {pendingPlayers.length}</li>}
                            {pendingGames.length > 0 && <li>игр: {pendingGames.length}</li>}
                        </ul>
                        {errorCount > 0 && (
                            <p className="text-destructive">
                                Записей с ошибкой: {errorCount}. Их можно отредактировать или удалить на
                                страницах партий и админки.
                            </p>
                        )}
                    </div>
                )}
                {authRequired && (
                    <div className="text-sm space-y-1">
                        <p className="text-destructive">Сессия истекла — войдите снова, чтобы сохранить на сервере.</p>
                        <LoginLink />
                    </div>
                )}
                {!offline && pendingCount > 0 && (
                    <Button size="sm" onClick={syncNow} disabled={isSyncing} className="w-full">
                        {isSyncing ? "Сохранение..." : "Сохранить на сервере"}
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    );
}
