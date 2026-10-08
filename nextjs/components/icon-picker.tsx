"use client"

import { CLUB_ICONS, clubIconSrc, isValidClubIcon } from "@/lib/club-icons";
import { cn } from "@/lib/utils";

/**
 * The built-in icon picker: a "no icon" button plus one button per icon of the
 * shared pool (lib/club-icons). Fully controlled — the caller owns the save
 * (club pages PATCH immediately; the tenant settings form saves on submit).
 */
export function IconPicker({
    value,
    onChange,
    disabled,
    label,
}: {
    value: string | null;
    onChange: (icon: string) => void;
    disabled?: boolean;
    label?: string;
}) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <button
                type="button"
                onClick={() => onChange("")}
                disabled={disabled}
                className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded border bg-muted/30 text-xs text-muted-foreground",
                    !isValidClubIcon(value) && "ring-2 ring-info border-info",
                )}
                title="Без иконки"
            >
                нет
            </button>
            {CLUB_ICONS.map(({ key, label: iconLabel }) => (
                <button
                    key={key}
                    type="button"
                    onClick={() => onChange(key)}
                    disabled={disabled}
                    className={cn(
                        "inline-flex h-12 w-12 items-center justify-center rounded border bg-muted/30",
                        value === key && "ring-2 ring-info border-info",
                    )}
                    title={iconLabel}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={clubIconSrc(key)} alt={iconLabel} className="h-8 w-8" />
                </button>
            ))}
            {label && <span className="sr-only">{label}</span>}
        </div>
    );
}
