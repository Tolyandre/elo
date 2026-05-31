"use client"

// ConvergenceChart — simulates how hidden elo and visible rating converge over matches
// for n players with configurable win probabilities.
// Uses the ADR-03 formula: scaleRatingEarned for rating track, gap-based promotion condition.

import { useEffect, useMemo, useState } from "react"
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useSettings } from "@/app/settingsContext"
import { ChartContainer } from "@/components/ui/chart"
import {
    scaleRatingEarned, scaleRatingStaked, normaliseScores,
    expectedScore, expectedScoreForRating,
} from "@/app/eloCalculation"

const PLAYER_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7"]

type SimPoint = Record<string, number> & { game: number }

function simulate(
    n: number,
    probs: number[],
    startingElo: number,
    startingRating: number,
    goalGap: number,
    K: number,
    D: number,
    earnedMin: number,
    earnedMax: number,
    earnedTau: number,
    W: number,
): SimPoint[] {
    const elos = Array(n).fill(startingElo)
    const ratings = Array(n).fill(startingRating)
    const leagues: string[] = Array(n).fill(
        Math.abs(startingElo - startingRating) <= goalGap ? "amateur" : "newbie"
    )

    const points: SimPoint[] = []

    const initial: SimPoint = { game: 0 }
    for (let i = 0; i < n; i++) {
        initial[`elo_${i}`] = elos[i]
        initial[`rating_${i}`] = ratings[i]
    }
    points.push(initial)

    for (let game = 1; game <= 200; game++) {
        const rand = Math.random()
        let cumulative = 0
        let winnerIdx = n - 1
        for (let i = 0; i < n; i++) {
            cumulative += probs[i]
            if (rand < cumulative) { winnerIdx = i; break }
        }
        const rawScores = Array(n).fill(0)
        rawScores[winnerIdx] = 1
        const S = normaliseScores(rawScores, W)

        const E_elo    = elos.map((_, i) => expectedScore(elos, i, D))
        const E_rating = elos.map((_, i) => expectedScoreForRating(elos, ratings, i, D))

        const newElos    = elos.map((e, i)    => e + K * (S[i] - E_elo[i]))
        const newRatings = ratings.map((r, i) => {
            const ratingEarnedRaw = K * S[i]
            const stakedRaw = -(K * E_rating[i])
            const staked = scaleRatingStaked(stakedRaw, elos[i], r, K, earnedMax, earnedTau)
            const earned = scaleRatingEarned(ratingEarnedRaw, elos[i], r, K, earnedMin, earnedMax, earnedTau)
            return r + staked + earned
        })

        for (let i = 0; i < n; i++) {
            elos[i]    = newElos[i]
            ratings[i] = newRatings[i]
            if (leagues[i] === "newbie" && elos[i] - ratings[i] <= goalGap) {
                leagues[i] = "amateur"
            }
        }

        const pt: SimPoint = { game }
        for (let i = 0; i < n; i++) {
            pt[`elo_${i}`] = Math.round(elos[i] * 10) / 10
            pt[`rating_${i}`] = Math.round(ratings[i] * 10) / 10
        }
        points.push(pt)

        const converged = elos.every((e, i) => e - ratings[i] <= goalGap)
        if (converged) break
    }

    return points
}

export function ConvergenceChart() {
    const settings = useSettings()
    const [mounted, setMounted] = useState(false)
    const [playerCount, setPlayerCount] = useState(2)
    const [probWeights, setProbWeights] = useState([50, 50, 33, 25])
    const [seed, setSeed] = useState(0)
    const [D,         setD]         = useState<number | null>(null)
    const [earnedTau, setEarnedTau] = useState<number | null>(null)

    useEffect(() => { setMounted(true) }, [])
    useEffect(() => {
        if (settings.eloConstD          > 0 && D         === null) setD(settings.eloConstD)
        if (settings.newbieLeagueEarnedTau > 0 && earnedTau === null) setEarnedTau(settings.newbieLeagueEarnedTau)
    }, [settings, D, earnedTau])

    const effD        = D         ?? (settings.eloConstD          || 400)
    const effEarnedTau = earnedTau ?? (settings.newbieLeagueEarnedTau || 100)

    const probs = useMemo(() => {
        const raw = probWeights.slice(0, playerCount)
        const total = raw.reduce((a, b) => a + b, 0)
        return raw.map(w => w / total)
    }, [probWeights, playerCount])

    const data = useMemo(() => {
        if (!mounted) return []
        void seed
        return simulate(
            playerCount, probs,
            settings.startingElo || 1000,
            settings.startingRatingGlobalArena,
            settings.newbieLeagueGoalGap || 16,
            settings.eloConstK || 32,
            effD,
            settings.newbieLeagueEarnedMin,
            settings.newbieLeagueEarnedMax,
            effEarnedTau,
            settings.winReward || 1,
        )
    }, [mounted, seed, playerCount, probs, settings, effD, effEarnedTau])

    const gamesPlayed = data.length - 1

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label>Количество игроков: {playerCount}</Label>
                    <Slider min={2} max={4} step={1} value={[playerCount]}
                        onValueChange={([v]) => setPlayerCount(v)} />
                </div>
                <div />
                <div className="space-y-2">
                    <Label>D (масштаб Elo): {effD}</Label>
                    <Slider min={100} max={1000} step={10} value={[effD]}
                        onValueChange={([v]) => setD(v)} />
                </div>
                <div className="space-y-2">
                    <Label>τ (скорость масштабирования earned): {effEarnedTau}</Label>
                    <Slider min={10} max={500} step={10} value={[effEarnedTau]}
                        onValueChange={([v]) => setEarnedTau(v)} />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Вероятность победы каждого игрока (пропорционально)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: playerCount }, (_, i) => (
                        <div key={i} className="space-y-1">
                            <Label className="text-xs" style={{ color: PLAYER_COLORS[i] }}>
                                Игрок {i + 1}: {Math.round(probs[i] * 100)}%
                            </Label>
                            <Slider
                                min={5} max={95} step={5}
                                value={[probWeights[i] ?? 50]}
                                onValueChange={([v]) => setProbWeights(prev => {
                                    const next = [...prev]
                                    next[i] = v
                                    return next
                                })}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setSeed(s => s + 1)}>
                    Перерисовать
                </Button>
                <span className="text-sm text-muted-foreground">
                    {gamesPlayed < 200
                        ? `Сошлись за ${gamesPlayed} ${gamesPlayed === 1 ? "партию" : gamesPlayed < 5 ? "партии" : "партий"}`
                        : "Не сошлись за 200 партий"}
                </span>
            </div>

            <ChartContainer config={{}} className="aspect-auto h-80">
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="game" label={{ value: "партия", position: "insideBottom", offset: -10 }} />
                    <YAxis />
                    <Tooltip formatter={(v) => Number(v).toFixed(0)} />
                    <Legend />
                    {Array.from({ length: playerCount }, (_, i) => [
                        <Line key={`elo_${i}`}    type="monotone" dataKey={`elo_${i}`}
                            stroke={PLAYER_COLORS[i]} strokeDasharray="5 3" strokeWidth={1.5} dot={false}
                            name={`эло ${i + 1}`} />,
                        <Line key={`rating_${i}`} type="monotone" dataKey={`rating_${i}`}
                            stroke={PLAYER_COLORS[i]} strokeWidth={2.5}                      dot={false}
                            name={`рейтинг ${i + 1}`} />,
                    ])}
                </LineChart>
            </ChartContainer>

            <p className="text-xs text-muted-foreground">
                Пунктир — скрытое эло (сумма постоянна). Сплошная — видимый рейтинг.
                Эло начинается с {settings.startingElo}, рейтинг с {settings.startingRatingGlobalArena}.
                Сходимость: эло − рейтинг ≤ {settings.newbieLeagueGoalGap} для всех игроков (не более 200 партий).
            </p>
        </div>
    )
}
