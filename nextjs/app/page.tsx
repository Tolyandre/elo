"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArenaView } from "@/app/arenas/view/arena-view";
import { useCamps } from "@/app/arenas/campsContext";

/**
 * Compact «Сейчас» block above the global arena: plain links to the camps
 * whose window contains today (from the preloaded camp list, ADR-27). Bracket
 * tournaments append their links here in ADR-26's UI phase.
 */
function NowCamps() {
    const { camps } = useCamps();
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
    if (active.length === 0) return null;
    return (
        <div className="max-w-sm mx-auto pt-1">
            <p>
                <span className="font-semibold">Сейчас:</span>{" "}
                {active.map((c, i) => (
                    <span key={c.id}>
                        {i > 0 && ", "}
                        <Link href={`/arenas/view?id=${c.id}`} className="underline">
                            {c.name}
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
            <NowCamps />
            <ArenaView />
        </>
    );
}
