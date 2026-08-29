"use client";

import { Plus, Pencil, Trash2 } from "lucide-react";
import type { AuditAction, AuditEntry } from "@/app/api";
import { auditIsExpandable, auditSummary } from "@/lib/audit-display";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { AuditEntryDetailsView } from "./audit-entry-details";

const ACTION_ICON: Record<AuditAction, typeof Plus> = {
    created: Plus,
    updated: Pencil,
    renamed: Pencil,
    deleted: Trash2,
};

/**
 * One audit event: action icon, "кто · что · когда" summary line. Rows with a
 * details payload (renames, match edits) expand via accordion; the summary is
 * the collapsed state, so who/date are always visible.
 */
export function AuditEntryRow({ entry, className }: { entry: AuditEntry; className?: string }) {
    const Icon = ACTION_ICON[entry.action];
    const summary = (
        <>
            <span className="font-medium">{entry.actor_name}</span>{" "}
            <span>{auditSummary(entry)}</span>
        </>
    );
    const meta = (
        <span className="text-sm text-muted-foreground">{formatDateTime(entry.created_at)}</span>
    );

    if (!auditIsExpandable(entry)) {
        return (
            <div className={cn("flex items-start gap-2 py-3", className)}>
                <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex flex-1 flex-wrap items-baseline gap-x-2">
                    {summary}
                    {meta}
                </div>
            </div>
        );
    }

    return (
        <Accordion type="single" collapsible className={cn("border-b-0", className)}>
            <AccordionItem value="details" className="border-b-0">
                <AccordionTrigger className="py-3 hover:no-underline">
                    <span className="flex items-start gap-2">
                        <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="flex flex-wrap items-baseline gap-x-2 text-left">
                            {summary}
                            {meta}
                        </span>
                    </span>
                </AccordionTrigger>
                <AccordionContent>
                    <AuditEntryDetailsView entry={entry} />
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
}
