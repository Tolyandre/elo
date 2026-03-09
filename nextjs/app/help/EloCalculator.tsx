"use client"

import { useMemo, useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useSettings } from "@/app/settingsContext"
import { calculateEloChanges } from "@/app/eloCalculation"

type PlayerRow = {
    elo: number
    score: number
}

type CalcForm = {
    k: number
    d: number
    playerCount: number
    players: PlayerRow[]
}

export function EloCalculator() {
    const settings = useSettings()
    const { isMobile } = useIsMobile()
    const [initialized, setInitialized] = useState(false)

    const { register, control, setValue } = useForm<CalcForm>({
        defaultValues: {
            k: 32,
            d: 400,
            playerCount: 3,
            players: Array.from({ length: 3 }, (_, i) => ({
                elo: 1000,
                score: 3 - i,
            })),
        },
    })

    // Initialize K and D from app settings when they load
    useEffect(() => {
        if (!initialized && settings.eloConstK > 0 && settings.eloConstD > 0) {
            setValue("k", settings.eloConstK)
            setValue("d", settings.eloConstD)
            setInitialized(true)
        }
    }, [settings.eloConstK, settings.eloConstD, initialized, setValue])

    const k = useWatch({ control, name: "k" })
    const d = useWatch({ control, name: "d" })
    const playerCount = useWatch({ control, name: "playerCount" })
    const players = useWatch({ control, name: "players" })

    // Sync player array length when playerCount changes
    useEffect(() => {
        const current = players?.length ?? 0
        if (current < playerCount) {
            const extra = Array.from({ length: playerCount - current }, (_, i) => ({
                elo: 1000,
                score: Math.max(1, current - i),
            }))
            setValue("players", [...(players ?? []), ...extra])
        } else if (current > playerCount) {
            setValue("players", (players ?? []).slice(0, playerCount))
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerCount])

    const results = useMemo(() => {
        if (!players || players.length < 2) return []
        const parsed = players.map((p, i) => ({
            id: String(i),
            elo: Number(p.elo) || 0,
            score: Number(p.score) || 0,
        }))
        const playerElos = new Map(parsed.map(p => [p.id, p.elo]))
        return calculateEloChanges(
            parsed.map(p => ({ id: p.id, points: p.score })),
            playerElos,
            Number(k) || 1,
            Number(d) || 1,
        )
    }, [players, k, d])

    const kVal = Number(k) || 1
    const dVal = Number(d) || 1

    return (
        <div className="space-y-6">
            {/* K and D sliders */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label>Коэффициент K = {kVal}</Label>
                    <Slider
                        min={1} max={100} step={1}
                        value={[kVal]}
                        onValueChange={([v]) => setValue("k", v)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Волатильность — насколько сильно меняется рейтинг за партию
                    </p>
                </div>
                <div className="space-y-2">
                    <Label>Коэффициент D = {dVal}</Label>
                    <Slider
                        min={100} max={800} step={10}
                        value={[dVal]}
                        onValueChange={([v]) => setValue("d", v)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Масштаб разницы рейтингов при расчёте ожидания
                    </p>
                </div>
            </div>

            {/* Number of players */}
            <div className="space-y-2">
                <Label>Количество игроков = {playerCount}</Label>
                <Slider
                    min={2} max={8} step={1}
                    value={[playerCount]}
                    onValueChange={([v]) => setValue("playerCount", v)}
                />
            </div>

            <Separator />

            {isMobile ? (
                /* Mobile: one card per player */
                <div className="flex flex-col gap-3">
                    {Array.from({ length: playerCount }, (_, i) => {
                        const res = results[i]
                        const currentElo = Number(players?.[i]?.elo) || 0
                        const delta = res ? res.delta : 0
                        // res.minus = -K·E (already negative), res.plus = K·S (positive)
                        const negKE = res ? res.minus : 0
                        const ksVal = res ? res.plus : 0
                        return (
                            <Card key={i}>
                                <CardContent className="pt-3 pb-3 space-y-2">
                                    <p className="font-semibold text-sm">Игрок {i + 1}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Текущий Elo</Label>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                                                {...register(`players.${i}.elo`)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Очки</Label>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                                                {...register(`players.${i}.score`)}
                                            />
                                        </div>
                                    </div>
                                    <Separator />
                                    <div className="grid grid-cols-4 gap-1 text-sm tabular-nums text-center">
                                        <span className="text-muted-foreground font-medium">−K·E</span>
                                        <span className="text-muted-foreground font-medium">K·S</span>
                                        <span className="text-muted-foreground font-medium">ΔR</span>
                                        <span className="text-muted-foreground font-medium">Elo</span>
                                        <span>{negKE.toFixed(1)}</span>
                                        <span>{ksVal.toFixed(1)}</span>
                                        <span className={`font-semibold ${delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                                        </span>
                                        <span>{Math.round(currentElo + delta)}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            ) : (
                /* Desktop: table */
                <table className="w-full text-sm table-fixed">
                    <thead>
                        <tr className="text-left text-muted-foreground">
                            <th className="pb-2 pr-2 font-medium w-6">#</th>
                            <th className="pb-2 pr-2 font-medium w-24">Текущий Elo</th>
                            <th className="pb-2 pr-2 font-medium w-20">Очки</th>
                            <th className="pb-2 pr-2 font-medium w-16">−K·E</th>
                            <th className="pb-2 pr-2 font-medium w-16">K·S</th>
                            <th className="pb-2 pr-2 font-medium w-16">ΔR</th>
                            <th className="pb-2 font-medium">Elo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: playerCount }, (_, i) => {
                            const res = results[i]
                            const currentElo = Number(players?.[i]?.elo) || 0
                            const delta = res ? res.delta : 0
                            const negKE = res ? res.minus : 0
                            const ksVal = res ? res.plus : 0
                            return (
                                <tr key={i} className="border-t">
                                    <td className="py-2 pr-2 font-medium">{i + 1}</td>
                                    <td className="py-2 pr-2">
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
                                            {...register(`players.${i}.elo`)}
                                        />
                                    </td>
                                    <td className="py-2 pr-2">
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            className="w-14 rounded border border-input bg-background px-2 py-1 text-sm"
                                            {...register(`players.${i}.score`)}
                                        />
                                    </td>
                                    <td className="py-2 pr-2 tabular-nums">
                                        {negKE.toFixed(1)}
                                    </td>
                                    <td className="py-2 pr-2 tabular-nums">{ksVal.toFixed(1)}</td>
                                    <td className={`py-2 pr-2 tabular-nums font-semibold ${delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                        {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                                    </td>
                                    <td className="py-2 tabular-nums">{Math.round(currentElo + delta)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}

            <p className="text-xs text-muted-foreground">
                K·E — плата за участие <br /> K·S — заработанные очки <br /> ΔR = K·S − K·E
            </p>

            <p className="text-xs text-muted-foreground">
                Сумма всех ΔR по партии равна нулю — рейтинг перераспределяется между игроками.
            </p>
        </div>
    )
}
