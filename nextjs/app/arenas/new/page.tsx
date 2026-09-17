"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/pageHeaderContext";
import { BackButton } from "@/components/back-button";
import { ArenaForm } from "../ArenaForm";

export default function NewArenaPage() {
    // ?kind=camp renders the camp variant (ADR-27): the «Создать кэмп» action
    // on the camps tab links here.
    const searchParams = useSearchParams();
    const isCamp = searchParams.get("kind") === "camp";
    return (
        <main className="max-w-md mx-auto space-y-6">
            <PageHeader title={isCamp ? "Новый кэмп" : "Новая арена"} />
            <BackButton href="/arenas" />
            <ArenaForm camp={isCamp} />
        </main>
    );
}
