"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/app/pageHeaderContext"
import { HELP_ARTICLES } from "./help-nav"

/** The documentation landing page: one card per article. */
export default function HelpIndexPage() {
    return (
        <div className="space-y-6">
            <PageHeader title="Справка" />
            <p className="text-sm leading-relaxed">
                Документация приложения: как устроен рейтинг Эло, арены и лиги, рынок предсказаний
                и турниры — и какие правила использования делают игру приятнее.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                {HELP_ARTICLES.map((a) => (
                    <Link key={a.href} href={a.href} className="group">
                        <Card className="h-full transition-colors group-hover:border-primary/40">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">{a.title}</CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm text-muted-foreground">{a.description}</CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}
