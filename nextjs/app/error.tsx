"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";

/**
 * Route-level error boundary. Without it a render-time exception in a client
 * component leaves the last painted frame on screen with no event handlers —
 * a page that looks fine but does not react to any click. In production the
 * dev overlay is absent, so this boundary is the only way a crash is visible
 * and recoverable.
 */
export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Surface the real cause in the console: a dead-looking page must leave
        // a trace.
        console.error("Unhandled page error:", error);
    }, [error]);

    return (
        <main className="max-w-sm mx-auto space-y-4 p-4">
            <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Что-то пошло не так</AlertTitle>
                <AlertDescription>
                    {error.message || "Неизвестная ошибка"}
                    {error.digest ? ` (код: ${error.digest})` : ""}
                </AlertDescription>
            </Alert>
            <div className="flex gap-3">
                <Button size="sm" onClick={reset}>
                    Повторить
                </Button>
                <Button asChild variant="outline" size="sm">
                    <a href="/arenas/view">На главную</a>
                </Button>
            </div>
        </main>
    );
}
