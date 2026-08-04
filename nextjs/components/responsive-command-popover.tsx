"use client";

/**
 * Encapsulates the mobile (BottomSheet) vs desktop (Popover) container for a
 * command-style picker, plus the duplicated trigger-button wiring. Extracted
 * from the per-combobox `useIsMobile ? BottomSheet : Popover` branches that were
 * copy-pasted across player-combobox and game-combobox.
 *
 * The caller supplies the trigger element and the command content; this
 * component owns `open`, renders the trigger with click handling on mobile, and
 * places `content` in a BottomSheet (mobile) or PopoverContent (desktop).
 */
import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import useIsMobile from "@/hooks/use-is-mobile";

export function ResponsiveCommandPopover({
    open,
    onOpenChange,
    trigger,
    content,
    /** Desktop-only extra className for PopoverContent. */
    desktopContentClassName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * The trigger. On desktop it is wrapped in PopoverTrigger; on mobile the
     * equivalent is cloned with an onClick that opens the sheet (since there is
     * no portal trigger). Use a plain element (e.g. `<Button>`); pass the same
     * element for both — we set `aria-expanded` via the consumer's own state.
     */
    trigger: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
    content: React.ReactNode;
    desktopContentClassName?: string;
}) {
    const { isMobile } = useIsMobile();

    if (isMobile) {
        return (
            <>
                {React.cloneElement(trigger, { onClick: () => onOpenChange(true) })}
                <BottomSheet open={open} onOpenChange={onOpenChange}>
                    <div className="px-4 pb-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                        {content}
                    </div>
                </BottomSheet>
            </>
        );
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
                className={`w-[var(--radix-popover-trigger-width)] p-0 ${desktopContentClassName ?? ""}`}
                side="bottom"
                align="start"
                avoidCollisions={false}
            >
                {content}
            </PopoverContent>
        </Popover>
    );
}
