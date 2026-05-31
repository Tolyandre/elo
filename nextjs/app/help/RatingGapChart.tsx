"use client"

// RatingGapChart — shows the asymmetric rating-track formula (ADR-03):
//
//   x < playerElo  (rating catching up):
//     rating_earned  is amplified via scaleRatingEarned
//     rating_staked  = elo_staked  (standard K)
//
//   x > playerElo  (rating overshot):
//     rating_staked  is amplified via scaleRatingStaked  (more negative)
//     rating_earned  = elo_earned  (standard K)
//
//   x = playerElo: all lines converge.

import { useMemo, useState, useEffect } from "react"
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ReferenceLine,
} from "recharts"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useSettings } from "@/app/settingsContext"
import { ChartContainer } from "@/components/ui/chart"
import { scaleRatingEarned, scaleRatingStaked, pairwiseExpected } from "@/app/eloCalculation"

export function RatingGapChart() {
    const settings = useSettings()

    const [playerElo, setPlayerElo] = useState<number | null>(null)
    const [opponentElo, setOpponentElo] = useState<number | null>(null)
    const [D, setD] = useState<number | null>(null)
    const [earnedTau, setEarnedTau] = useState<number | null>(null)

    useEffect(() => {
        if (settings.startingElo > 0 && playerElo === null) {
            setPlayerElo(settings.startingElo)
            setOpponentElo(settings.startingElo)
        }
        if (settings.eloConstD > 0 && D === null) setD(settings.eloConstD)
        if (settings.newbieLeagueEarnedTau > 0 && earnedTau === null) setEarnedTau(settings.newbieLeagueEarnedTau)
    }, [settings, playerElo, D, earnedTau])

    const effPlayerElo = playerElo ?? (settings.startingElo || 1000)
    const effOpponentElo = opponentElo ?? (settings.startingElo || 1000)
    const effD = D ?? (settings.eloConstD || 400)
    const effTau = earnedTau ?? (settings.newbieLeagueEarnedTau || 100)
    const K = settings.eloConstK || 32
    const earnedMin = settings.newbieLeagueEarnedMin
    const earnedMax = settings.newbieLeagueEarnedMax

    const data = useMemo(() => {
        const xMax = Math.ceil(effPlayerElo * 1.7 / 50) * 50
        const step = Math.max(xMax / 120, 1)
        const points = []
        for (let rating = 0; rating <= xMax; rating += step) {
            const E = pairwiseExpected(rating, effOpponentElo, effD)
            const eloStaked = -(K * E)
            const eloEarned = K * (1 - E)
            // Asymmetric: scale earned when rating < elo, scale staked when rating > elo
            const ratingEarned = scaleRatingEarned(eloEarned, effPlayerElo, rating, K, earnedMin, earnedMax, effTau)
            const ratingStaked = scaleRatingStaked(eloStaked, effPlayerElo, rating, K, earnedMax, effTau)
            points.push({
                rating: Math.round(rating),
                elo_staked: parseFloat(eloStaked.toFixed(3)),
                elo_earned: parseFloat(eloEarned.toFixed(3)),
                rating_staked: parseFloat(ratingStaked.toFixed(3)),
                rating_earned: parseFloat(ratingEarned.toFixed(3)),
            })
        }
        return points
    }, [effPlayerElo, effOpponentElo, effD, effTau, K, earnedMin, earnedMax])

    const sliderMax = Math.round(effPlayerElo * 2 + 200)

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label>Эло игрока (точка сходимости): {effPlayerElo}</Label>
                    <Slider min={100} max={sliderMax} step={10}
                        value={[effPlayerElo]}
                        onValueChange={([v]) => setPlayerElo(v)} />
                </div>
                <div className="space-y-2">
                    <Label>Эло противника: {effOpponentElo}</Label>
                    <Slider min={100} max={sliderMax} step={10}
                        value={[effOpponentElo]}
                        onValueChange={([v]) => setOpponentElo(v)} />
                </div>
                <div className="space-y-2">
                    <Label>D (масштаб Elo): {effD}</Label>
                    <Slider min={100} max={1000} step={10}
                        value={[effD]}
                        onValueChange={([v]) => setD(v)} />
                </div>
                <div className="space-y-2">
                    <Label>τ (скорость масштабирования): {effTau}</Label>
                    <Slider min={10} max={500} step={10}
                        value={[effTau]}
                        onValueChange={([v]) => setEarnedTau(v)} />
                </div>
            </div>

            <ChartContainer config={{}} className="aspect-auto h-80">
                <LineChart data={data} margin={{ top: 4, right: 12, bottom: 32, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                        dataKey="rating"
                        label={{ value: "видимый рейтинг", position: "insideBottom", offset: -12 }}
                    />
                    <YAxis />
                    <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 8 }} />
                    <ReferenceLine
                        x={effPlayerElo}
                        stroke="#94a3b8"
                        strokeDasharray="2 2"
                        label={{ value: "эло", position: "insideTopRight", fontSize: 11, fill: "#94a3b8" }}
                    />
                    <Line type="monotone" dataKey="elo_staked" stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5} dot={false} name="elo_staked" />
                    <Line type="monotone" dataKey="elo_earned" stroke="#a3e635" strokeDasharray="5 3" strokeWidth={1.5} dot={false} name="elo_earned" />
                    <Line type="monotone" dataKey="rating_staked" stroke="#f97316" strokeWidth={2.5} dot={false} name="rating_staked" />
                    <Line type="monotone" dataKey="rating_earned" stroke="#15803d" strokeWidth={2.5} dot={false} name="rating_earned" />
                </LineChart>
            </ChartContainer>

            <p className="text-xs text-muted-foreground">
                Слева от эло: <strong>rating_earned</strong> (сплошная тёмно-зелёная) усилен — рейтинг растёт быстрее. <strong>rating_staked</strong> = elo_staked.
            </p>
            <p className="text-xs text-muted-foreground">
                Справа от эло: <strong>rating_staked</strong> (сплошная оранжевая) усилен — рейтинг снижается быстрее обратно к эло. <strong>rating_earned</strong> = elo_earned.
            </p>
            <p className="text-xs text-muted-foreground">
                Пунктир — elo-трек (лайм = earned, красный = staked). Сплошная — rating-трек (тёмно-зелёный = earned, оранжевый = staked).
            </p>
        </div>
    )
}
