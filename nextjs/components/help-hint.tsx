"use client";

import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A small help icon with a hint — the standard place for short "how to
 * extend this" instructions (e.g. how to add an image to a pool in /public).
 * A click-toggled popover, not a hover tooltip: Radix tooltips flash open/closed
 * on touch taps (the pointerdown suppresses the focus-open and click closes),
 * so the hint must survive a tap — same pattern as the guarantors info.
 */
export function HelpHint({ children, label = "Подсказка" }: { children: React.ReactNode; label?: string }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                >
                    <CircleHelp className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 text-xs text-muted-foreground">
                {children}
            </PopoverContent>
        </Popover>
    );
}
