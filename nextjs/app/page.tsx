"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Tent, Trophy } from "lucide-react";
import { ArenaView } from "@/app/arenas/view/arena-view";
import { useCamps } from "@/app/arenas/campsContext";
import { useTournaments } from "@/app/tournaments/tournamentsContext";
import { useTenantScope } from "@/app/tenantScopeContext";
import { MarketsHighlight } from "@/components/markets-highlight";
import { RunningTables } from "@/components/tables/running-tables";
import { TenantChooser } from "@/components/tenant-chooser";
import { LoadingRows } from "@/components/loading-rows";
import { PageContainer } from "@/components/page-container";

/**
 * Compact «Сейчас» block above the community arena: plain links to the camps
 * whose window contains today (ADR-27) and the tournaments currently in
 * registration or running (ADR-26) — from the preloaded lists. Each entry
 * carries the mark of its kind (camp tent / tournament trophy).
 */
function NowBlock() {
    const { camps } = useCamps();
    const { activeTournaments } = useTournaments();
    // Frozen at mount, same as the arenas page's open/ended split.
    const [now] = useState(() => new Date());
    const active = useMemo(
        () =>
            camps.filter(
                (c) =>
                    new Date(c.starts_at).getTime() <= now.getTime() &&
                    now.getTime() <= new Date(c.ends_at).getTime(),
            ),
        [camps, now],
    );
    if (active.length === 0 && activeTournaments.length === 0) return null;
    const links = [
        ...active.map((c) => ({
            key: c.id,
            href: `/arenas/view?id=${c.id}`,
            name: c.name,
            icon: <Tent className="mr-0.5 inline-block h-4 w-4 align-middle" />,
        })),
        ...activeTournaments.map((t) => ({
            key: t.id,
            href: `/tournaments/view?id=${t.id}`,
            name: t.name,
            icon: <Trophy className="mr-0.5 inline-block h-4 w-4 align-middle" />,
        })),
    ];
    return (
        <div className="max-w-sm mx-auto pt-1">
            <p>
                <span className="font-semibold">Сейчас:</span>{" "}
                {links.map((l, i) => (
                    <span key={l.key}>
                        {i > 0 && ", "}
                        <Link href={l.href} className="underline whitespace-nowrap">
                            {l.icon}
                            {l.name}
                        </Link>
                    </span>
                ))}
            </p>
        </div>
    );
}

// The community arena is the main page (ADR-24, ADR-25, ADR-36): the arena view renders
// here directly, without an id. It must not be a redirect() page — a
// statically exported redirect is an empty shell with a client-side replay,
// which made every visit to / (and every PWA launch — the manifest start_url
// is /) blink through an extra hop.
//
// Everything on the page belongs to a community, so with no tenant in force
// the chooser substitutes the whole content — the page never defaults to a
// community the user did not pick (ADR-36 phase 7).
export default function MainPage() {
    const { ready, tenantId } = useTenantScope();
    if (!ready) {
        return (
            <PageContainer width="narrow">
                <LoadingRows count={6} />
            </PageContainer>
        );
    }
    if (!tenantId) {
        return (
            <PageContainer width="narrow">
                <div className="max-w-sm mx-auto py-8">
                    <TenantChooser />
                </div>
            </PageContainer>
        );
    }
    return (
        <>
            <NowBlock />
            {/* Live tables sit between the «Сейчас» block and the arena tabs:
                something that needs attention right now (a table waiting for
                a bid) outranks the tabbed lists below. */}
            <RunningTables />
            {/* Active markets and the day's resolutions — the markets lobby
                used to live on its own page; the feed below carries the rest
                of the market story (ADR-32). */}
            <MarketsHighlight />
            <ArenaView />
        </>
    );
}
