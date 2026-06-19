"use client";

import type { Tournament } from "@/app/api";

/**
 * Shared tournament picker used by the match form and the calculators. Mandatory
 * tournaments (all players are members) are rendered checked + locked because the
 * server applies them regardless; the rest are toggleable for an explicit host choice.
 */
export function TournamentCheckboxes({
    active,
    checked,
    isMandatory,
    onToggle,
    title = "Турниры:",
}: {
    active: Tournament[];
    checked: string[];
    isMandatory: (id: string) => boolean;
    onToggle: (id: string, checked: boolean) => void;
    title?: string;
}) {
    if (active.length === 0) return null;
    return (
        <div>
            <h2 className="font-semibold mb-2">{title}</h2>
            <div className="flex flex-col gap-2">
                {active.map((t) => {
                    const mandatory = isMandatory(t.id);
                    return (
                        <label
                            key={t.id}
                            className={`flex items-center gap-2 ${mandatory ? "cursor-default" : "cursor-pointer"}`}
                        >
                            <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={mandatory || checked.includes(t.id)}
                                disabled={mandatory}
                                onChange={(e) => onToggle(t.id, e.target.checked)}
                            />
                            <span>{t.name}</span>
                            {mandatory && (
                                <span className="text-muted-foreground text-xs">(все игроки)</span>
                            )}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
