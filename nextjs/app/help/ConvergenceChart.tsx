"use client"

// ConvergenceChart — simulates how hidden elo and visible rating converge over matches
// for n players with configurable win probabilities.
//
// Cross-references (keep in sync when calculation changes):
//   - ratingK formula:        elo-web-service/pkg/elo/matches.go:ratingK
//   - applyNewbieClamping:    elo-web-service/pkg/elo/matches.go:applyNewbieClamping
//   - WinExpectation formula: elo-web-service/pkg/elo/elo.go:WinExpectation
//   - NormalizedScore:        elo-web-service/pkg/elo/elo.go:NormalizedScore

import { useEffect, useMemo, useState } from "react"
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useSettings } from "@/app/settingsContext"
import { ChartContainer } from "@/components/ui/chart"

// Mirror of elo-web-service/pkg/elo/matches.go:ratingK
function ratingK(gap: number, kStd: number, kMax: number, tau: number): number {
    return kStd + (kMax - kStd) * (1 - Math.exp(-Math.abs(gap) / tau))
}

// Mirror of elo-web-service/pkg/elo/matches.go:applyNewbieClamping
function applyNewbieClamping(league: string, staked: number, earned: number): [number, number] {
    if (league === "newbie" && staked + earned < 0) return [0, 1]
    return [staked, earned]
}

// Mirror of elo-web-service/pkg/elo/elo.go:NormalizedScore (with WinReward W).
// Returns normalised scores summing to 1.
function normaliseScores(rawScores: number[], W: number): number[] {
    const min = Math.min(...rawScores)
    const shifted = rawScores.map(s => Math.pow(Math.max(s - min, 0), W))
    const total = shifted.reduce((a, b) => a + b, 0)
    if (total === 0) return rawScores.map(() => 1 / rawScores.length)
    return shifted.map(v => v / total)
}

// Mirror of elo-web-service/pkg/elo/elo.go:WinExpectation (elo track).
// Sums p_ij for all j≠i, divides by pairs count.  Σ_i E_i = 1 → Elo is conserved.
function expectedScore(elos: number[], i: number, D: number): number {
    let sum = 0
    for (let j = 0; j < elos.length; j++) {
        if (j !== i) sum += 1 / (1 + Math.pow(10, (elos[j] - elos[i]) / D))
    }
    return sum / (elos.length * (elos.length - 1) / 2)
}

// Mirror of elo-web-service/pkg/elo/matches.go:buildEloResults (rating track, lines ~489-492).
// For the RATING track, player i's expected score uses their VISIBLE RATING as their own elo,
// while all opponents still use their TRUE elos.
//
// This is the convergence engine: when rating[i] < elo[i]:
//   E_rating[i] = p(rating[i] beats elos[j]) < p(elos[i] beats elos[j]) = E_elo[i]
// → rating_staked = kR * E_rating  is SMALLER than elo_staked = K * E_elo
// → net rating gain per game > net elo gain per game  →  rating rises toward elo
//
// As rating → elo: E_rating → E_elo and kR → K → excess disappears (stable at convergence).
function expectedScoreForRating(elos: number[], ratings: number[], i: number, D: number): number {
    let sum = 0
    for (let j = 0; j < elos.length; j++) {
        // player i is seen at ratings[i]; opponents are at their true elos[j]
        if (j !== i) sum += 1 / (1 + Math.pow(10, (elos[j] - ratings[i]) / D))
    }
    return sum / (elos.length * (elos.length - 1) / 2)
}

const PLAYER_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7"]

type SimPoint = Record<string, number> & { game: number }

function simulate(
    n: number,
    probs: number[],
    startingElo: number,
    startingRating: number,
    newbieLeagueGoal: number,
    K: number,
    D: number,
    kMax: number,
    tau: number,
    W: number,
): SimPoint[] {
    const elos = Array(n).fill(startingElo)
    const ratings = Array(n).fill(startingRating)
    const leagues: string[] = Array(n).fill(startingRating >= newbieLeagueGoal ? "amateur" : "newbie")

    const points: SimPoint[] = []

    const initial: SimPoint = { game: 0 }
    for (let i = 0; i < n; i++) {
        initial[`elo_${i}`] = elos[i]
        initial[`rating_${i}`] = ratings[i]
    }
    points.push(initial)

    for (let game = 1; game <= 200; game++) {
        // Pick a winner randomly according to configured win probabilities.
        // Winner gets raw score 1, losers 0 → after normalisation winner S=1, others S=0.
        // This guarantees Σ S_i = 1, and together with Σ E_i = 1 ensures Elo is conserved.
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

        // All expectations computed from the same snapshot (prev elos/ratings),
        // matching the Go implementation which reads state once before writing.
        const E_elo    = elos.map((_, i) => expectedScore(elos, i, D))
        const E_rating = elos.map((_, i) => expectedScoreForRating(elos, ratings, i, D))

        // Compute new values for all players before mutating state.
        const newElos    = elos.map((e, i)    => e + K * (S[i] - E_elo[i]))
        const newRatings = ratings.map((r, i) => {
            const gap = elos[i] - r  // gap from prev state (prev elo, prev rating)
            const kRating = ratingK(gap, K, kMax, tau)
            let staked = -(kRating * E_rating[i])
            let earned = kRating * S[i]
            ;[staked, earned] = applyNewbieClamping(leagues[i], staked, earned)
            return r + staked + earned
        })

        for (let i = 0; i < n; i++) {
            elos[i]    = newElos[i]
            ratings[i] = newRatings[i]
            if (leagues[i] === "newbie" && newRatings[i] >= newbieLeagueGoal) {
                leagues[i] = "amateur"
            }
        }

        const pt: SimPoint = { game }
        for (let i = 0; i < n; i++) {
            pt[`elo_${i}`] = Math.round(elos[i] * 10) / 10
            pt[`rating_${i}`] = Math.round(ratings[i] * 10) / 10
        }
        points.push(pt)

        const converged = elos.every((e, i) => Math.round(e) === Math.round(ratings[i]))
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
    const [D,   setD]   = useState<number | null>(null)
    const [tau, setTau] = useState<number | null>(null)

    useEffect(() => { setMounted(true) }, [])
    useEffect(() => {
        if (settings.eloConstD  > 0 && D   === null) setD(settings.eloConstD)
        if (settings.ratingKTau > 0 && tau === null) setTau(settings.ratingKTau)
    }, [settings, D, tau])

    const effD   = D   ?? (settings.eloConstD  || 400)
    const effTau = tau ?? (settings.ratingKTau || 100)

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
            settings.startingRating || 0,
            settings.newbieLeagueGoal || 500,
            settings.eloConstK || 32,
            effD,
            settings.ratingMaxK || 64,
            effTau,
            settings.winReward || 1,
        )
    }, [mounted, seed, playerCount, probs, settings, effD, effTau])

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
                    <Label>τ (скорость сходимости K): {effTau}</Label>
                    <Slider min={10} max={500} step={10} value={[effTau]}
                        onValueChange={([v]) => setTau(v)} />
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
                Эло начинается с {settings.startingElo}, рейтинг с {settings.startingRating}.
                Симуляция останавливается, когда round(эло) = round(рейтинг) для всех, не более 200 партий.
            </p>
        </div>
    )
}
