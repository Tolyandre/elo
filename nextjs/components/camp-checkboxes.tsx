"use client";

import type { CampArena } from "@/app/arenas/campsContext";
import type { Base58ID } from "@/lib/id";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Camp arena picker (ADR-27) used by the match form and the calculators.
 * On creation the camps are default-checked by the participation rule
 * (computed in useCampSelection); on edit they are pre-checked with the
 * match's camps — links are editable, the server diffs the submitted set.
 */
export function CampCheckboxes({
    active,
    checked,
    onToggle,
    title = "Кэмпы:",
}: {
    active: CampArena[];
    checked: Base58ID[];
    onToggle: (id: Base58ID, checked: boolean) => void;
    title?: string;
}) {
    if (active.length === 0) return null;
    return (
        <div>
            <h2 className="font-semibold mb-2">{title}</h2>
            <div className="flex flex-col gap-2">
                {active.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                            checked={checked.includes(c.id)}
                            onCheckedChange={(v) => onToggle(c.id, v === true)}
                        />
                        <span>{c.name}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}
