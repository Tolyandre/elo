"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TABLE_PAGE_PATH } from "@/lib/game-apps";

// The per-game table pages merged into the unified /matches/table page (the
// game is resolved from the table's game_id there). Kept as a client redirect
// for old shared links and precached service-worker shells — a static export
// has no server-side redirects. The query is read straight from the location
// (not via the reactive query hook): the redirect must fire once, before any
// same-route param write could strip it.
export default function LegacyIawwTablePage() {
    const router = useRouter();
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const table = params.get("table") ?? params.get("join");
        router.replace(table ? `${TABLE_PAGE_PATH}?table=${table}` : TABLE_PAGE_PATH);
    }, [router]);
    return null;
}
