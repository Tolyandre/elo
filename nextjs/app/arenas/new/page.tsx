"use client";

import { PageHeader } from "@/app/pageHeaderContext";
import { BackButton } from "@/components/back-button";
import { ArenaForm } from "../ArenaForm";

export default function NewArenaPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <PageHeader title="Новая арена" />
            <BackButton href="/arenas" />
            <ArenaForm />
        </main>
    );
}
