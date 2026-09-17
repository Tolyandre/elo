"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { BackButton } from "@/components/back-button";
import { ArenaForm } from "../ArenaForm";

function NewArenaContent() {
    // ?kind=camp renders the camp variant (ADR-27): the «Создать кэмп» action
    // on the camps tab links here. useSearchParams bails out of prerendering,
    // so it (and everything reading it) must sit behind a Suspense boundary
    // on the static export.
    const searchParams = useSearchParams();
    const isCamp = searchParams.get("kind") === "camp";
    return (
        <>
            <PageHeader title={isCamp ? "Новый кэмп" : "Новая арена"} />
            <ArenaForm camp={isCamp} />
        </>
    );
}

export default function NewArenaPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <BackButton href="/arenas" />
            <Suspense fallback={<p>Загрузка...</p>}>
                <NewArenaContent />
            </Suspense>
        </main>
    );
}
