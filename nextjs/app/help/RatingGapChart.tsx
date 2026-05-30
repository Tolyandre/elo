"use client"

// RatingGapChart — elo_staked, elo_earned, rating_staked, rating_earned
// as a function of the player's visible rating for a hypothetical WIN against
// a configurable opponent.
//
// Why E uses visible_rating as player's effective elo:
//   A player with visible_rating=0 is a beginner; opponents (elo=starting_elo)
//   expect them to lose, so E≈0 and elo_staked≈0.  As visible_rating grows the
//   player is seen as stronger and E increases.  At x=player_elo the gap is zero
//   and all four lines converge (rating track = elo track).
//
// Shows two outcomes of the same hypothetical game:
//   "earned" = net change IF PLAYER WINS  = K*(1−E) or K_r*(1−E)
//   "staked" = net change IF PLAYER LOSES = −K*E   or −K_r*E
//
// Both earned and staked now depend on E, and thus on opponent_elo and visible_rating.
// K_r amplifies both compared to the elo track when gap > 0.
//
//   E(x)          = 1 / (1 + 10^((opponent_elo − x) / D))   [x = visible_rating as player elo]
//   gap(x)        = player_elo − x
//   K_r(x)        = ratingK(gap(x), K_std, K_max, τ)
//   elo_earned(x) = K_std · (1−E(x))   positive, larger against stronger opponents
//   elo_staked(x) = −K_std · E(x)      negative, smaller against stronger opponents
//   rating_earned = K_r(x) · (1−E(x))  elo_earned scaled up by K_r/K_std
//   rating_staked = −K_r(x) · E(x)     elo_staked scaled up by K_r/K_std
//
// At x = player_elo: gap=0, K_r=K_std → rating lines = elo lines (convergence point).
//
// Cross-reference: ratingK mirrors elo-web-service/pkg/elo/matches.go:ratingK
// Cross-reference: E formula mirrors elo-web-service/pkg/elo/elo.go:WinExpectation

import { useMemo, useState, useEffect } from "react"
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ReferenceLine,
} from "recharts"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useSettings } from "@/app/settingsContext"
import { ChartContainer } from "@/components/ui/chart"

// Mirror of elo-web-service/pkg/elo/matches.go:ratingK
function ratingK(gap: number, kStd: number, kMax: number, tau: number): number {
    return kStd + (kMax - kStd) * (1 - Math.exp(-Math.abs(gap) / tau))
}

export function RatingGapChart() {
    const settings = useSettings()

    const [playerElo, setPlayerElo] = useState<number | null>(null)
    const [opponentElo, setOpponentElo] = useState<number | null>(null)
    const [D, setD] = useState<number | null>(null)
    const [tau, setTau] = useState<number | null>(null)

    useEffect(() => {
        if (settings.startingElo > 0 && playerElo === null) {
            setPlayerElo(settings.startingElo)
            setOpponentElo(settings.startingElo)
        }
        if (settings.eloConstD > 0 && D === null) setD(settings.eloConstD)
        if (settings.ratingKTau > 0 && tau === null) setTau(settings.ratingKTau)
    }, [settings, playerElo, D, tau])

    const effPlayerElo = playerElo ?? (settings.startingElo || 1000)
    const effOpponentElo = opponentElo ?? (settings.startingElo || 1000)
    const effD = D ?? (settings.eloConstD || 400)
    const effTau = tau ?? (settings.ratingKTau || 100)
    const K = settings.eloConstK || 32
    const kMax = settings.ratingMaxK || 64

    const data = useMemo(() => {
        const xMax = Math.ceil(effPlayerElo * 1.5 / 50) * 50
        const step = Math.max(xMax / 100, 1)
        const points = []
        for (let rating = 0; rating <= xMax; rating += step) {
            // E: use visible_rating as player's effective elo (see file comment).
            const E = 1 / (1 + Math.pow(10, (effOpponentElo - rating) / effD))
            const gap = effPlayerElo - rating
            const Kr = ratingK(gap, K, kMax, effTau)
            // Two outcomes shown per x:
            //   earned = net elo/rating change on a WIN  = K*(1-E) or Kr*(1-E)
            //   staked = net elo/rating change on a LOSE = -K*E    or -Kr*E
            // All four values depend on E (→ opponent elo) and K_r (→ gap → player elo).
            points.push({
                rating: Math.round(rating),
                elo_staked: parseFloat((-(K * E)).toFixed(3)),
                elo_earned: parseFloat((K * (1 - E)).toFixed(3)),
                rating_staked: parseFloat((-(Kr * E)).toFixed(3)),
                rating_earned: parseFloat((Kr * (1 - E)).toFixed(3)),
            })
        }
        return points
    }, [effPlayerElo, effOpponentElo, effD, effTau, K, kMax])

    const sliderMax = Math.round(Math.max(settings.startingElo, settings.startingRating) * 2 + 200)

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
                    <Label>τ (скорость сходимости K): {effTau}</Label>
                    <Slider min={10} max={500} step={10}
                        value={[effTau]}
                        onValueChange={([v]) => setTau(v)} />
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
                    {/* Legend at top avoids overlapping the x-axis label */}
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 8 }} />
                    <ReferenceLine
                        x={effPlayerElo}
                        stroke="#94a3b8"
                        strokeDasharray="2 2"
                        label={{ value: "эло", position: "insideTopRight", fontSize: 11, fill: "#94a3b8" }}
                    />
                    <Line type="monotone" dataKey="elo_staked" stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5} dot={false} name="elo_staked" />
                    <Line type="monotone" dataKey="elo_earned" stroke="#22c55e" strokeDasharray="5 3" strokeWidth={1.5} dot={false} name="elo_earned" />
                    <Line type="monotone" dataKey="rating_staked" stroke="#f97316" strokeWidth={2.5} dot={false} name="rating_staked" />
                    <Line type="monotone" dataKey="rating_earned" stroke="#16a34a" strokeWidth={2.5} dot={false} name="rating_earned" />
                </LineChart>
            </ChartContainer>

            <p className="text-xs text-muted-foreground">
                <strong>earned</strong> - прирост значения, зависит от результата партии
            </p>
            <p className="text-xs text-muted-foreground">
                <strong>staked</strong> - отдача значения, зависит от разницы между эло игроков
            </p>
            <p className="text-xs text-muted-foreground">
                Пунктир — elo-трек (K_std={K}). Сплошная — rating-трек (K до K_max={kMax}).
            </p>

        </div>
    )
}
