"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArenaView } from "@/app/arenas/view/arena-view";
import { useCamps } from "@/app/arenas/campsContext";
import { useTournaments } from "@/app/tournaments/tournamentsContext";
import { RunningTables } from "@/components/tables/running-tables";

/**
 * Compact «Сейчас» block above the global arena: plain links to the camps
 * whose window contains today (ADR-27) and the tournaments currently in
 * registration or running (ADR-26) — from the preloaded lists.
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
        ...active.map((c) => ({ key: c.id, href: `/arenas/view?id=${c.id}`, name: c.name })),
        ...activeTournaments.map((t) => ({ key: t.id, href: `/tournaments/view?id=${t.id}`, name: t.name })),
    ];
    return (
        <div className="max-w-sm mx-auto pt-1">
            <p>
                <span className="font-semibold">Сейчас:</span>{" "}
                {links.map((l, i) => (
                    <span key={l.key}>
                        {i > 0 && ", "}
                        <Link href={l.href} className="underline">
                            {l.name}
                        </Link>
                    </span>
                ))}
            </p>
        </div>
    );
}

// The global arena is the main page (ADR-24, ADR-25): the arena view renders
// here directly, without an id. It must not be a redirect() page — a
// statically exported redirect is an empty shell with a client-side replay,
// which made every visit to / (and every PWA launch — the manifest start_url
// is /) blink through an extra hop.
export default function MainPage() {
    return (
        <>
            <NowBlock />
            {/* Live tables sit between the «Сейчас» block and the arena tabs:
                something that needs attention right now (a table waiting for
                a bid) outranks the tabbed lists below. */}
            <RunningTables />
            <ArenaView />
        </>
    );
}
