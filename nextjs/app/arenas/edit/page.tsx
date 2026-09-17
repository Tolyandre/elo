"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toBase58ID } from "@/lib/id";
import { PageHeader } from "@/app/pageHeaderContext";
import { BackButton } from "@/components/back-button";
import { Arena, getArenaPromise } from "@/app/api";
import { ArenaForm } from "../ArenaForm";

function EditArenaContent() {
    const searchParams = useSearchParams();
    const id = toBase58ID(searchParams.get("id") ?? "");
    const [arena, setArena] = useState<Arena | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setLoading(true);
        getArenaPromise(id)
            .then(setArena)
            .finally(() => setLoading(false));
    }, [id]);

    if (!id) return <p>Не указан ID арены.</p>;
    if (loading) return <p>Загрузка...</p>;
    if (!arena) return <p>Арена не найдена.</p>;
    // Auto-managed arenas (per-game, per-tournament) are system-owned; their
    // name follows the entity and the API rejects edits with 409. Camp arenas
    // are user-created and editable.
    if (arena.game_id != null || arena.tournament_id != null) {
        return <p>Эта арена управляется автоматически и не может быть изменена.</p>;
    }

    return <ArenaForm existing={arena} />;
}

export default function EditArenaPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <PageHeader title="Редактирование" />
            <BackButton href="/arenas" />
            <Suspense fallback={<p>Загрузка...</p>}>
                <EditArenaContent />
            </Suspense>
        </main>
    );
}
