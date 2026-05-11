"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { usePlayers } from "@/app/players/PlayersContext"
import { PlayerMultiSelect } from "@/components/player-multi-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import {
    GripVertical,
    ChevronUp,
    ChevronDown,
    Pause,
    Play,
    RotateCcw,
    Check,
    ArrowLeft,
    Sun,
} from "lucide-react"
import { PageHeader } from "@/app/pageHeaderContext"

// ─── Types ────────────────────────────────────────────────────────────────────

type PlayerConfig = { id: string; name: string; color: string }
type TimerMode = "countdown" | "elapsed"

type ChessClockState = {
    phase: "setup" | "playing" | "paused"
    players: PlayerConfig[]
    mode: TimerMode
    initialTimeMs: number
    incrementMs: number
    activePlayerIndex: number
    baseTimersMs: number[]
    turnsPlayed: number[]
    activeSince: number | null
    totalBaseMs: number
    totalSince: number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = "chess-clock/state"

const PLAYER_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#eab308",
    "#a855f7",
    "#f97316",
    "#ec4899",
    "#14b8a6",
]

const COLOR_LABELS = [
    "Синий", "Красный", "Зелёный", "Жёлтый",
    "Фиолетовый", "Оранжевый", "Розовый", "Бирюзовый",
]

const INITIAL_STATE: ChessClockState = {
    phase: "setup",
    players: [],
    mode: "countdown",
    initialTimeMs: 15 * 60 * 1000,
    incrementMs: 0,
    activePlayerIndex: 0,
    baseTimersMs: [],
    turnsPlayed: [],
    activeSince: null,
    totalBaseMs: 0,
    totalSince: null,
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
    const neg = ms < 0
    const abs = Math.abs(ms)
    const totalSecs = Math.floor(abs / 1000)
    const mins = Math.floor(totalSecs / 60)
    const secs = totalSecs % 60
    return `${neg ? "−" : ""}${mins}:${String(secs).padStart(2, "0")}`
}

function getTimerMs(state: ChessClockState, i: number, nowMs: number): number {
    const base = state.baseTimersMs[i]
    if (i !== state.activePlayerIndex || state.activeSince === null) return base
    const elapsed = nowMs - state.activeSince
    return state.mode === "countdown" ? base - elapsed : base + elapsed
}

function getTotalMs(state: ChessClockState, nowMs: number): number {
    if (state.totalSince === null) return state.totalBaseMs
    return state.totalBaseMs + (nowMs - state.totalSince)
}

// ─── PlayerSector ─────────────────────────────────────────────────────────────

function PlayerSector({
    player,
    rotation,
    timerMs,
    isActive,
    isCountdown,
    onEndTurn,
    onTap,
}: {
    player: PlayerConfig
    rotation: number
    timerMs: number
    isActive: boolean
    isCountdown: boolean
    onEndTurn: () => void
    onTap: () => void
}) {
    const isNegative = isCountdown && timerMs < 0
    const is90 = rotation === 90 || rotation === -90
    const bgAlpha = isActive ? "55" : "18"

    return (
        <div
            className="flex-1 flex items-center justify-center overflow-hidden relative select-none"
            style={{
                backgroundColor: player.color + bgAlpha,
                borderColor: isActive ? player.color : "transparent",
                borderWidth: 3,
                borderStyle: "solid",
            }}
            onClick={onTap}
        >
            <div
                className="flex flex-col items-center gap-3 px-4 text-center"
                style={{
                    transform: `rotate(${rotation}deg)`,
                    maxWidth: is90 ? "min(90vh, 600px)" : undefined,
                }}
            >
                <div
                    className="text-sm font-semibold tracking-wide uppercase"
                    style={{ color: player.color }}
                >
                    {player.name}
                </div>
                <div
                    className="font-bold tabular-nums leading-none"
                    style={{
                        fontSize: "clamp(2.5rem, 8vw, 5rem)",
                        color: isNegative
                            ? "#ef4444"
                            : isActive
                              ? "currentColor"
                              : "color-mix(in oklch, currentColor 40%, transparent)",
                    }}
                >
                    {formatTime(timerMs)}
                </div>
                {isActive && (
                    <Button
                        size="lg"
                        className="text-sm px-6 mt-1"
                        style={{ backgroundColor: player.color, borderColor: player.color }}
                        onClick={(e) => {
                            e.stopPropagation()
                            onEndTurn()
                        }}
                    >
                        Конец хода
                    </Button>
                )}
            </div>
        </div>
    )
}

// ─── TimerLayout ──────────────────────────────────────────────────────────────

// Players are arranged clockwise:
//   2 players:  left (9 o'clock) → right (3 o'clock)
//   3+ players: top row L→R, then bottom row R→L (reversing player indices)

function TimerLayout({
    state,
    nowMs,
    onEndTurn,
    onTap,
}: {
    state: ChessClockState
    nowMs: number
    onEndTurn: (i: number) => void
    onTap: () => void
}) {
    const { players, mode } = state
    const N = players.length

    // 2 players: left/right split.
    // Left player faces east  → rotate( 90°): text flows top→bottom, readable from the west side.
    // Right player faces west → rotate(-90°): text flows bottom→top, readable from the east side.
    if (N === 2) {
        return (
            <div className="flex flex-row h-full">
                {[0, 1].map((i) => (
                    <PlayerSector
                        key={i}
                        player={players[i]}
                        rotation={i === 0 ? 90 : -90}
                        timerMs={getTimerMs(state, i, nowMs)}
                        isActive={i === state.activePlayerIndex}
                        isCountdown={mode === "countdown"}
                        onEndTurn={() => onEndTurn(i)}
                        onTap={onTap}
                    />
                ))}
            </div>
        )
    }

    // 3+ players: two rows, clockwise order.
    // Top row:    indices 0 … topCount-1  rendered left→right  (rotate 180°)
    // Bottom row: indices N-1 … topCount  rendered left→right  (rotate 0°)
    // This traces top-left→top-right→bottom-right→…→bottom-left = clockwise.
    const topCount = Math.floor(N / 2)
    const topIndices = Array.from({ length: topCount }, (_, i) => i)
    const bottomCount = N - topCount
    const bottomIndices = Array.from({ length: bottomCount }, (_, j) => N - 1 - j)

    return (
        <div className="flex flex-col h-full">
            <div className="flex flex-row flex-1">
                {topIndices.map((i) => (
                    <PlayerSector
                        key={i}
                        player={players[i]}
                        rotation={180}
                        timerMs={getTimerMs(state, i, nowMs)}
                        isActive={i === state.activePlayerIndex}
                        isCountdown={mode === "countdown"}
                        onEndTurn={() => onEndTurn(i)}
                        onTap={onTap}
                    />
                ))}
            </div>
            <div className="flex flex-row flex-1">
                {bottomIndices.map((i) => (
                    <PlayerSector
                        key={i}
                        player={players[i]}
                        rotation={0}
                        timerMs={getTimerMs(state, i, nowMs)}
                        isActive={i === state.activePlayerIndex}
                        isCountdown={mode === "countdown"}
                        onEndTurn={() => onEndTurn(i)}
                        onTap={onTap}
                    />
                ))}
            </div>
        </div>
    )
}

// ─── PauseMenu ────────────────────────────────────────────────────────────────

function PauseMenu({
    open,
    state,
    onResume,
    onRestart,
    onAdjustTimer,
    onSetActive,
}: {
    open: boolean
    state: ChessClockState
    onResume: () => void
    onRestart: () => void
    onAdjustTimer: (i: number, deltaMs: number) => void
    onSetActive: (i: number) => void
}) {
    const [confirmRestart, setConfirmRestart] = useState(false)

    return (
        <>
            <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onResume() }}>
                <DialogContent
                    className="max-w-sm"
                    showCloseButton={false}
                    onInteractOutside={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle>Пауза</DialogTitle>
                    </DialogHeader>

                    <div className="text-center text-sm text-muted-foreground">
                        Общее время игры:{" "}
                        <span className="font-mono font-semibold text-foreground">
                            {formatTime(state.totalBaseMs)}
                        </span>
                    </div>

                    <div className="space-y-1.5">
                        {state.players.map((player, i) => {
                            const ms = state.baseTimersMs[i] ?? 0
                            const isActive = i === state.activePlayerIndex
                            const isNeg = state.mode === "countdown" && ms < 0
                            return (
                                <div
                                    key={i}
                                    className={`flex items-center gap-2 rounded-lg p-2 cursor-pointer transition-colors ${isActive ? "bg-accent" : "hover:bg-muted"}`}
                                    style={{ borderLeft: `4px solid ${player.color}` }}
                                    onClick={() => onSetActive(i)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium flex items-center gap-1.5">
                                            {isActive && (
                                                <Check
                                                    className="h-3.5 w-3.5 shrink-0"
                                                    style={{ color: player.color }}
                                                />
                                            )}
                                            <span className="truncate">{player.name}</span>
                                        </div>
                                        <div
                                            className="text-lg font-bold tabular-nums"
                                            style={{ color: isNeg ? "#ef4444" : undefined }}
                                        >
                                            {formatTime(ms)}
                                        </div>
                                    </div>
                                    <div
                                        className="flex gap-1 shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 w-10 p-0 text-base"
                                            onClick={() => onAdjustTimer(i, 60_000)}
                                        >
                                            +
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 w-10 p-0 text-base"
                                            onClick={() => onAdjustTimer(i, -60_000)}
                                        >
                                            −
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex gap-2 pt-1">
                        <Button className="flex-1" onClick={onResume}>
                            <Play className="h-4 w-4 mr-1.5" />
                            Продолжить
                        </Button>
                        <Button variant="outline" onClick={() => setConfirmRestart(true)}>
                            <RotateCcw className="h-4 w-4 mr-1.5" />
                            Заново
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Начать заново?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Все таймеры и прогресс игры будут сброшены.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={onRestart}>
                            Заново
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

// ─── SetupScreen ──────────────────────────────────────────────────────────────

function SetupScreen({
    state,
    onStart,
}: {
    state: ChessClockState
    onStart: (
        players: PlayerConfig[],
        mode: TimerMode,
        initialMs: number,
        incrementMs: number
    ) => void
}) {
    const { players: allPlayers, playerDisplayName } = usePlayers()
    const [selectedIds, setSelectedIds] = useState<string[]>(state.players.map((p) => p.id))
    const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>(state.players)
    const [mode, setMode] = useState<TimerMode>(state.mode)
    const [initialMinutes, setInitialMinutes] = useState(Math.floor(state.initialTimeMs / 60_000))
    const [initialSeconds, setInitialSeconds] = useState(
        Math.floor((state.initialTimeMs % 60_000) / 1000)
    )
    const [incrementSeconds, setIncrementSeconds] = useState(
        Math.floor(state.incrementMs / 1000)
    )
    const [openColorPickerIdx, setOpenColorPickerIdx] = useState<number | null>(null)

    const dragIndexRef = useRef<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    useEffect(() => {
        setPlayerConfigs((prev) =>
            selectedIds.map((id, index) => {
                const existing = prev.find((p) => p.id === id)
                if (existing) return existing
                const player = allPlayers.find((p) => p.id === id)
                const usedColors = new Set(prev.map((p) => p.color))
                const color =
                    PLAYER_COLORS.find((c) => !usedColors.has(c)) ??
                    PLAYER_COLORS[index % PLAYER_COLORS.length]
                return {
                    id,
                    name: player ? playerDisplayName(player) : id,
                    color,
                }
            })
        )
    }, [selectedIds, allPlayers, playerDisplayName])

    function handleDragStart(index: number) {
        dragIndexRef.current = index
    }
    function handleDragOver(e: React.DragEvent, index: number) {
        e.preventDefault()
        setDragOverIndex(index)
    }
    function handleDrop(index: number) {
        const from = dragIndexRef.current
        if (from === null || from === index) {
            dragIndexRef.current = null
            setDragOverIndex(null)
            return
        }
        const newIds = [...selectedIds]
        const [removed] = newIds.splice(from, 1)
        newIds.splice(index, 0, removed)
        setSelectedIds(newIds)
        dragIndexRef.current = null
        setDragOverIndex(null)
    }
    function handleDragEnd() {
        dragIndexRef.current = null
        setDragOverIndex(null)
    }
    function moveUp(index: number) {
        if (index === 0) return
        const newIds = [...selectedIds]
        ;[newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]]
        setSelectedIds(newIds)
    }
    function moveDown(index: number) {
        if (index === selectedIds.length - 1) return
        const newIds = [...selectedIds]
        ;[newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]]
        setSelectedIds(newIds)
    }
    function setColor(index: number, hex: string) {
        setPlayerConfigs((prev) => prev.map((p, i) => (i === index ? { ...p, color: hex } : p)))
        setOpenColorPickerIdx(null)
    }

    function handleStart() {
        const ms = (initialMinutes * 60 + initialSeconds) * 1000
        onStart(
            playerConfigs,
            mode,
            Math.max(ms, 0),
            Math.max(incrementSeconds, 0) * 1000
        )
    }

    return (
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Игроки</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <PlayerMultiSelect value={selectedIds} onChange={setSelectedIds} />

                    {playerConfigs.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">
                                Порядок и цвет:
                            </p>
                            {playerConfigs.map((player, index) => (
                                <div key={player.id}>
                                    <div
                                        draggable
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDrop={() => handleDrop(index)}
                                        onDragEnd={handleDragEnd}
                                        className={`flex items-center gap-2 rounded px-1 cursor-grab active:cursor-grabbing transition-colors ${dragOverIndex === index ? "bg-accent" : ""}`}
                                    >
                                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="flex-1 text-sm">
                                            {index + 1}. {player.name}
                                        </span>
                                        <button
                                            className="w-5 h-5 rounded-full border-2 border-background shadow shrink-0"
                                            style={{
                                                backgroundColor: player.color,
                                                outline: `2px solid ${player.color}`,
                                            }}
                                            onClick={() =>
                                                setOpenColorPickerIdx(
                                                    openColorPickerIdx === index ? null : index
                                                )
                                            }
                                            title="Изменить цвет"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={index === 0}
                                            onClick={() => moveUp(index)}
                                        >
                                            <ChevronUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={index === playerConfigs.length - 1}
                                            onClick={() => moveDown(index)}
                                        >
                                            <ChevronDown className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    {openColorPickerIdx === index && (
                                        <div className="flex gap-2 flex-wrap pl-8 py-1.5">
                                            {PLAYER_COLORS.map((hex, ci) => (
                                                <button
                                                    key={hex}
                                                    className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                                                    style={{
                                                        backgroundColor: hex,
                                                        borderColor:
                                                            player.color === hex ? "#000" : "#fff",
                                                        outline:
                                                            player.color === hex
                                                                ? "2px solid #000"
                                                                : undefined,
                                                    }}
                                                    title={COLOR_LABELS[ci]}
                                                    onClick={() => setColor(index, hex)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Режим</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2">
                        <Button
                            variant={mode === "countdown" ? "default" : "outline"}
                            className="flex-1"
                            onClick={() => setMode("countdown")}
                        >
                            Обратный отсчёт
                        </Button>
                        <Button
                            variant={mode === "elapsed" ? "default" : "outline"}
                            className="flex-1"
                            onClick={() => setMode("elapsed")}
                        >
                            Затраченное время
                        </Button>
                    </div>

                    {mode === "countdown" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Label className="w-36 text-sm shrink-0">Начальное время</Label>
                                <input
                                    type="number"
                                    min={0}
                                    max={999}
                                    value={initialMinutes}
                                    onChange={(e) => setInitialMinutes(Number(e.target.value))}
                                    className="w-16 rounded border border-input bg-background px-2 py-1 text-sm text-center"
                                />
                                <span className="text-sm text-muted-foreground">мин</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={59}
                                    value={initialSeconds}
                                    onChange={(e) =>
                                        setInitialSeconds(Number(e.target.value))
                                    }
                                    className="w-14 rounded border border-input bg-background px-2 py-1 text-sm text-center"
                                />
                                <span className="text-sm text-muted-foreground">сек</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label className="w-36 text-sm shrink-0">Добавлять за ход</Label>
                                <input
                                    type="number"
                                    min={0}
                                    max={999}
                                    value={incrementSeconds}
                                    onChange={(e) =>
                                        setIncrementSeconds(Number(e.target.value))
                                    }
                                    className="w-16 rounded border border-input bg-background px-2 py-1 text-sm text-center"
                                />
                                <span className="text-sm text-muted-foreground">сек</span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Button
                className="w-full h-12 text-base"
                disabled={playerConfigs.length < 2}
                onClick={handleStart}
            >
                Запустить
            </Button>
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChessClockPage() {
    const [state, setState] = useLocalStorage<ChessClockState>(LS_KEY, INITIAL_STATE)
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [showNav, setShowNav] = useState(false)
    const [wakeLockEnabled, setWakeLockEnabled] = useState(false)
    const wakeLockRef = useRef<any>(null)
    const wakeLockSupported =
        typeof window !== "undefined" && "wakeLock" in navigator

    // Tick interval for display
    useEffect(() => {
        if (state.phase !== "playing") return
        const id = setInterval(() => setNowMs(Date.now()), 100)
        return () => clearInterval(id)
    }, [state.phase])

    // Wake lock management
    const acquireWakeLock = useCallback(async () => {
        if (!wakeLockSupported) return
        try {
            wakeLockRef.current = await (navigator as any).wakeLock.request("screen")
            wakeLockRef.current.addEventListener("release", () => {
                setWakeLockEnabled(false)
                wakeLockRef.current = null
            })
            setWakeLockEnabled(true)
        } catch {
            setWakeLockEnabled(false)
        }
    }, [wakeLockSupported])

    const releaseWakeLock = useCallback(() => {
        wakeLockRef.current?.release().catch(() => {})
        wakeLockRef.current = null
        setWakeLockEnabled(false)
    }, [])

    // Re-acquire after tab visibility change (browser releases it automatically)
    useEffect(() => {
        if (!wakeLockEnabled) return
        const handler = () => {
            if (document.visibilityState === "visible") acquireWakeLock()
        }
        document.addEventListener("visibilitychange", handler)
        return () => document.removeEventListener("visibilitychange", handler)
    }, [wakeLockEnabled, acquireWakeLock])

    // Auto-acquire when game starts, release when returning to setup
    useEffect(() => {
        if (state.phase === "playing") {
            acquireWakeLock()
        } else if (state.phase === "setup") {
            releaseWakeLock()
        }
    }, [state.phase, acquireWakeLock, releaseWakeLock])

    function toggleWakeLock() {
        if (wakeLockEnabled) releaseWakeLock()
        else acquireWakeLock()
    }

    function handleStart(
        players: PlayerConfig[],
        mode: TimerMode,
        initialMs: number,
        incrementMs: number
    ) {
        const now = Date.now()
        setState({
            phase: "playing",
            players,
            mode,
            initialTimeMs: initialMs,
            incrementMs,
            activePlayerIndex: 0,
            baseTimersMs: players.map(() => (mode === "countdown" ? initialMs : 0)),
            turnsPlayed: players.map(() => 0),
            activeSince: now,
            totalBaseMs: 0,
            totalSince: now,
        })
    }

    function handleEndTurn(i: number) {
        const now = Date.now()
        const N = state.players.length
        const newBaseTimers = [...state.baseTimersMs]
        newBaseTimers[i] = getTimerMs(state, i, now)
        const newTurnsPlayed = [...state.turnsPlayed]
        newTurnsPlayed[i] += 1
        const next = (i + 1) % N
        if (state.mode === "countdown" && newTurnsPlayed[next] > 0) {
            newBaseTimers[next] += state.incrementMs
        }
        setState({
            ...state,
            baseTimersMs: newBaseTimers,
            turnsPlayed: newTurnsPlayed,
            activePlayerIndex: next,
            activeSince: now,
        })
        setShowNav(false)
    }

    function handlePause() {
        const now = Date.now()
        const newBaseTimers = [...state.baseTimersMs]
        newBaseTimers[state.activePlayerIndex] = getTimerMs(
            state,
            state.activePlayerIndex,
            now
        )
        setState({
            ...state,
            phase: "paused",
            baseTimersMs: newBaseTimers,
            activeSince: null,
            totalBaseMs: getTotalMs(state, now),
            totalSince: null,
        })
        setShowNav(false)
    }

    function handleResume() {
        const now = Date.now()
        setState({ ...state, phase: "playing", activeSince: now, totalSince: now })
        setShowNav(false)
    }

    function handleRestart() {
        setState(INITIAL_STATE)
        setShowNav(false)
    }

    function handleAdjustTimer(i: number, deltaMs: number) {
        const newBaseTimers = [...state.baseTimersMs]
        newBaseTimers[i] = (newBaseTimers[i] ?? 0) + deltaMs
        setState({ ...state, baseTimersMs: newBaseTimers })
    }

    function handleSetActive(i: number) {
        setState({ ...state, activePlayerIndex: i })
    }

    if (state.phase === "setup") {
        return (
            <>
                <PageHeader title="Шахматные часы" />
                <SetupScreen state={state} onStart={handleStart} />
            </>
        )
    }

    return (
        <>
            <div
                className="fixed inset-0 z-50 bg-background overflow-hidden"
            >
                <div className="h-full relative">
                    <TimerLayout
                        state={state}
                        nowMs={nowMs}
                        onEndTurn={handleEndTurn}
                        onTap={() => setShowNav((v) => !v)}
                    />

                    {/* Center pause button */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Button
                            variant="outline"
                            size="icon"
                            className="pointer-events-auto w-14 h-14 rounded-full shadow-lg bg-background/90 backdrop-blur-sm border-2"
                            disabled={state.phase === "paused"}
                            onClick={(e) => {
                                e.stopPropagation()
                                handlePause()
                            }}
                        >
                            <Pause className="h-6 w-6" />
                        </Button>
                    </div>

                    {/* Collapsible nav bar — shown on background tap */}
                    {showNav && (
                        <div
                            className="absolute top-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-b flex items-center justify-between px-3 py-2 gap-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Link
                                href="/calculators"
                                className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80 transition-colors"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Калькуляторы
                            </Link>
                            {wakeLockSupported && (
                                <Button
                                    variant={wakeLockEnabled ? "default" : "outline"}
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={toggleWakeLock}
                                >
                                    <Sun className="h-3.5 w-3.5" />
                                    Экран не выключается
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <PauseMenu
                open={state.phase === "paused"}
                state={state}
                onResume={handleResume}
                onRestart={handleRestart}
                onAdjustTimer={handleAdjustTimer}
                onSetActive={handleSetActive}
            />
        </>
    )
}
