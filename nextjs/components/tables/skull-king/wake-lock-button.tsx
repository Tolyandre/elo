"use client";

import { Button } from "@/components/ui/button";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Lightbulb, LightbulbOff } from "lucide-react";

/**
 * The tables-page header screen-lock toggle: a host driving a live game keeps
 * the screen from dimming. Rendered for games that opt in via their registry
 * entry's headerExtras.
 */
export function WakeLockButton() {
    const { supported, enabled, toggle } = useWakeLock();
    if (!supported) return null;
    return (
        <Button
            variant={enabled ? "secondary" : "ghost"}
            size="sm"
            onClick={toggle}
            title={enabled ? "Экран не выключается" : "Экран может потухнуть"}
        >
            {enabled
                ? <Lightbulb className="h-4 w-4" />
                : <LightbulbOff className="h-4 w-4" />}
        </Button>
    );
}
