"use client";

import type { ReactNode } from "react";
import type { AuditEntityType } from "@/app/api";
import type { Base58ID } from "@/lib/id";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditLog } from "@/components/audit/audit-log";

/**
 * Shared layout of the admin pages: the page's existing content on the main
 * tab and the entity-type's audit log (latest first) on the last tab. The
 * audit tab mounts lazily — the feed is fetched only when opened.
 */
export function AdminPageTabs({
    entityType,
    entityId,
    mainLabel = "Основное",
    extraTab,
    children,
}: {
    entityType: AuditEntityType | AuditEntityType[];
    /** Narrow the log to one entity (club detail page); omit for the type-wide feed. */
    entityId?: Base58ID;
    mainLabel?: string;
    /** Optional middle tab between the main tab and the audit log (e.g. games → tags). */
    extraTab?: { label: string; content: ReactNode };
    children: ReactNode;
}) {
    return (
        <Tabs defaultValue="main" className="mt-4">
            <TabsList>
                <TabsTrigger value="main">{mainLabel}</TabsTrigger>
                {extraTab && <TabsTrigger value="extra">{extraTab.label}</TabsTrigger>}
                <TabsTrigger value="audit">Журнал</TabsTrigger>
            </TabsList>
            <TabsContent value="main">{children}</TabsContent>
            {extraTab && <TabsContent value="extra">{extraTab.content}</TabsContent>}
            <TabsContent value="audit">
                <AuditLog entityType={entityType} entityId={entityId} />
            </TabsContent>
        </Tabs>
    );
}
