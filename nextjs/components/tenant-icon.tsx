import { isValidClubIcon, clubIconSrc } from "@/lib/club-icons";
import { cn } from "@/lib/utils";

/**
 * The tenant's icon in front of its name — club-icon behavior for tenants
 * (ADR-36). Renders nothing when the tenant has no (valid) icon, so call
 * sites keep their layout without conditionals.
 */
export function TenantIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
    if (!isValidClubIcon(icon)) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={clubIconSrc(icon)}
            alt=""
            aria-hidden
            className={cn("inline-block h-4 w-4 shrink-0 object-contain", className)}
        />
    );
}
