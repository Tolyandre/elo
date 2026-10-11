"use client";

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A small help icon with a tooltip — the standard place for short "how to
 * extend this" instructions (e.g. how to add an image to a pool in /public).
 */
export function HelpHint({ children, label = "Подсказка" }: { children: React.ReactNode; label?: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                >
                    <CircleHelp className="size-4" />
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 text-start">{children}</TooltipContent>
        </Tooltip>
    );
}
