import { cn } from "@/lib/utils";

/**
 * Shared before → after diff primitives — the style every change list in the
 * app speaks (audit details, offline op changes). The old value is struck
 * through, the new one emphasized; null sides render as a dash.
 */

/** A name-ish before → after pair. */
export function NameDiff({ from, to }: { from: string | null; to: string | null }) {
    return (
        <>
            <span className={cn("text-muted-foreground", from && "line-through")}>{from ?? "—"}</span>
            {" → "}
            <span className="font-medium">{to ?? "—"}</span>
        </>
    );
}

/** `label:` + NameDiff row of a details `<dl>`. */
export function DiffRow({ label, from, to }: { label: string; from: string | null; to: string | null }) {
    return (
        <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{label}:</dt>
            <dd><NameDiff from={from} to={to} /></dd>
        </div>
    );
}
