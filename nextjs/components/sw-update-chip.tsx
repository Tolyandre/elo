"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { parseSwMessage } from "@/lib/sw-messages";

/**
 * Non-blocking header chip showing precache download progress while a new
 * service worker version installs (or the offline cache is first populated).
 * Purely informational: it never blocks navigation or interaction, and once
 * the download completes with a version update pending, SwUpdateReloader
 * reloads the page and the chip disappears with it.
 *
 * Progress comes from the worker's `sw-precache-progress` messages; the
 * `registration.installing` check covers the gap before the first entry
 * completes (or when another tab triggered the update).
 */
export function SwUpdateChip() {
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    // False only on the very first install (no worker controlled the page at
    // mount), where the completion wording differs: no reload will follow.
    const [hadController, setHadController] = useState(
        () => typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller,
    );

    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration: navigator is only available after mount
        setHadController(!!navigator.serviceWorker.controller);

        const onMessage = (event: MessageEvent) => {
            const msg = parseSwMessage(event.data);
            if (msg?.type === "sw-precache-progress") setProgress({ done: msg.done, total: msg.total });
        };
        // A new worker taking over means the page reloads (SwUpdateReloader);
        // on a first-ever install there is no reload, so hide the chip here.
        const onControllerChange = () => setProgress(null);
        navigator.serviceWorker.addEventListener("message", onMessage);
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        navigator.serviceWorker
            .getRegistration()
            .then((reg) => {
                if (reg?.installing) setProgress((p) => p ?? { done: 0, total: 0 });
            })
            .catch(() => { /* no registration — nothing to show */ });

        return () => {
            navigator.serviceWorker.removeEventListener("message", onMessage);
            navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        };
    }, []);

    // done === total means every precache entry was processed. The reload (if
    // one is coming) usually beats this timer; on a first install there is no
    // reload, so the chip dismisses itself.
    const complete = progress !== null && progress.total > 0 && progress.done >= progress.total;
    useEffect(() => {
        if (!complete) return;
        const timer = window.setTimeout(() => setProgress(null), 2500);
        return () => window.clearTimeout(timer);
    }, [complete]);

    if (!progress) return null;

    const known = progress.total > 0;
    const percent = known ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-0.5 px-1.5 shrink-0 text-muted-foreground"
                    aria-label={hadController ? "Обновление приложения" : "Первичная загрузка приложения"}
                >
                    <Spinner className="size-4" />
                    {percent !== null && (
                        <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[10px] leading-none tabular-nums">
                            {percent}%
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <p className="text-sm">
                    {known
                        ? `Загружаются файлы приложения: ${progress.done} из ${progress.total}.`
                        : "Загружаются файлы приложения…"}{" "}
                    {hadController
                        ? "Когда обновление завершится, страница перезагрузится автоматически."
                        : "Когда загрузка завершится, приложение сможет работать без сети."}
                </p>
            </PopoverContent>
        </Popover>
    );
}
