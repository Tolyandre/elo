"use client";

import Link from "next/link";
import { PageHeader } from "@/app/pageHeaderContext";
import { TournamentForm } from "../TournamentForm";

export default function NewTournamentPage() {
    return (
        <main className="max-w-md mx-auto space-y-6">
            <PageHeader title="Новый турнир" />
            <div>
                <Link href="/tournaments" className="text-sm text-blue-600">Назад</Link>
            </div>
            <TournamentForm />
        </main>
    );
}
