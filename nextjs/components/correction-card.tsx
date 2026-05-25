"use client"
import { Correction } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function CorrectionCard({ correction }: { correction: Correction }) {
    const positive = correction.diff >= 0;
    const diffLabel = `${positive ? "+" : ""}${correction.diff.toFixed(1)}`;
    const date = correction.date
        ? correction.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : null;

    return (
        <Card>
            <CardContent className="py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-muted-foreground">
                        Корректировка
                    </Badge>
                    {date && <span className="text-xs text-muted-foreground">{date}</span>}
                </div>
                <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{correction.player_name}</span>
                    <span className={`font-semibold tabular-nums shrink-0 ${positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {diffLabel}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
