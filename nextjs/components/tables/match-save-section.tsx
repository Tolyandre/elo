"use client";

import type { ReactNode } from "react";
import { CampCheckboxes } from "@/components/camp-checkboxes";
import type { CampSelection } from "@/hooks/useCampSelection";

/**
 * The table pages' save area: camp checkboxes (ADR-27), the save error, and
 * the page's own save control as children — a plain button or a confirm
 * dialog, the one part that genuinely differs per game. `selection` comes
 * from useCampSelection.
 */
export function MatchSaveSection({
    selection,
    error,
    className = "",
    children,
}: {
    selection: CampSelection;
    error?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={`space-y-2 ${className}`.trim()}>
            <CampCheckboxes
                active={selection.active}
                checked={selection.checked}
                onToggle={selection.toggle}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {children}
        </div>
    );
}
