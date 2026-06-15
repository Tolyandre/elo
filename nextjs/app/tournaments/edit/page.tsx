"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { Tournament, getTournamentPromise } from "@/app/api";
import { TournamentForm } from "../TournamentForm";

function EditTournamentContent() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id") ?? "";
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading indicator before async fetch
        setLoading(true);
        getTournamentPromise(id)
            .then(setTournament)
            .finally(() => setLoading(false));
    }, [id]);

    if (!id) return <p>Не указан ID турнира.</p>;
    if (loading) return <p>Загрузка...</p>;
    if (!tournament) return <p>Турнир не найден.</p>;

    return <TournamentForm existing={tournament} />;
}

export default function EditTournamentPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <PageHeader title="Редактирование турнира" />
            <div>
                <Link href="/tournaments" className="text-sm text-blue-600">Назад</Link>
            </div>
            <Suspense fallback={<p>Загрузка...</p>}>
                <EditTournamentContent />
            </Suspense>
        </main>
    );
}
