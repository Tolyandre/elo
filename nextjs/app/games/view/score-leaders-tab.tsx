"use client"

import { GameMatch } from "@/app/api";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computeWinnerScoreStats, formatPlayerCount, ScoreLeadersSection } from "./score-leaders-stats";

export function ScoreLeadersTab({ matches, loading, gameName }: { matches: GameMatch[]; loading: boolean; gameName?: string }) {
    if (loading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-48 w-full rounded-xl" />
            </div>
        );
    }

    const sections = computeWinnerScoreStats(matches);
    if (sections.length === 0) {
        return <p className="text-sm text-muted-foreground">Нет партий</p>;
    }
    return (
        <div className="space-y-4">
            {sections.map((section) => (
                <ScoreLeadersSectionView key={section.playerCount} section={section} gameName={gameName} />
            ))}
        </div>
    );
}

function ScoreLeadersSectionView({ section, gameName }: { section: ScoreLeadersSection; gameName?: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{formatPlayerCount(section.playerCount)}</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="space-y-1">
                    <h4 className="text-sm font-medium text-muted-foreground">
                        Распределение очков победителей{gameName ? ` ${gameName}` : ""}
                    </h4>
                    <ChartContainer
                        className="aspect-auto h-48 w-full"
                        config={{ count: { label: "Партий", color: "var(--chart-1)" } }}
                    >
                        <BarChart data={section.distribution}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                stroke="var(--muted-foreground)"
                                label={{ value: "Очки", position: "insideBottom", offset: -2, fill: "var(--muted-foreground)", fontSize: 10 }}
                            />
                            <YAxis
                                allowDecimals={false}
                                domain={[0, (dataMax: number) => dataMax + 1]}
                                width={44}
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                stroke="var(--muted-foreground)"
                                label={{ value: "Количество партий", angle: -90, position: "insideLeft", textAnchor: "middle", fill: "var(--muted-foreground)", fontSize: 10 }}
                            />
                            <ChartTooltip
                                content={(props) => (
                                    <ChartTooltipContent
                                        active={props.active}
                                        payload={props.payload}
                                        label={props.label}
                                        coordinate={props.coordinate}
                                        accessibilityLayer={props.accessibilityLayer}
                                        activeIndex={props.activeIndex}
                                    />
                                )}
                            />
                            <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                        </BarChart>
                    </ChartContainer>
                </div>

                <div className="space-y-1">
                    <h4 className="text-sm font-medium text-muted-foreground">Топ-5 очков победителей</h4>
                    {section.topScores.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Нет данных</p>
                    ) : (
                        <ol className="space-y-1 text-sm">
                            {section.topScores.map((top) => (
                                <li key={top.score} className="flex items-baseline gap-2">
                                    <span className="font-mono font-medium tabular-nums">{top.score}</span>
                                    <span className="text-muted-foreground">
                                        {top.achievers.map(a => a.count > 1 ? `${a.name} ×${a.count}` : a.name).join(", ")}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
