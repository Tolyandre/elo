"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GAME_APPS } from "@/lib/game-apps";
import { PageHeader } from "@/app/pageHeaderContext";
import { MatchForm, MatchFormAuthAlerts } from "../MatchForm";

// Two ways to record a game here: create a live table (host drives the game,
// connected players submit their own input) or submit a finished match by
// hand. The live game apps themselves live under /matches/table/<kind>
// (see lib/game-apps.ts).
export default function NewMatchPage() {
    return (
        <main className="max-w-sm mx-auto p-4 space-y-6">
            <PageHeader title="Результат партии" />
            <MatchFormAuthAlerts />
            <Card>
                <CardHeader>
                    <CardTitle>Создать стол</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="divide-y -my-2">
                        {GAME_APPS.map((app) => {
                            const Icon = app.icon;
                            return (
                                <Link
                                    key={app.id}
                                    // ?new=1: a new table is always created here —
                                    // any running table stays reachable via /matches
                                    // or the header game icons.
                                    href={`${app.href}?new=1`}
                                    className="flex items-center gap-3 py-3 hover:text-foreground/80 transition-colors"
                                >
                                    <Icon className="h-6 w-6" />
                                    <span className="text-sm font-medium">{app.title}</span>
                                </Link>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
            <MatchForm />
        </main>
    );
}
