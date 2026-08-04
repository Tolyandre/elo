"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { useWakeLock } from "@/hooks/useWakeLock"
import { Button } from "@/components/ui/button"
import { Pause, ArrowLeft, Sun } from "lucide-react"
import { PageHeader } from "@/app/pageHeaderContext"
import {
    type ChessClockState,
    type PlayerConfig,
    type TimerMode,
    LS_KEY,
    INITIAL_STATE,
    getTimerMs,
    getTotalMs,
} from "./types"
import { TimerLayout, PauseMenu, SetupScreen } from "./components"

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChessClockPage() {
    const [state, setState] = useLocalStorage<ChessClockState>(LS_KEY, INITIAL_STATE)
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [showNav, setShowNav] = useState(false)
    const wakeLock = useWakeLock()

    // Tick interval for display
    useEffect(() => {
        if (state.phase !== "playing") return
        const id = setInterval(() => setNowMs(Date.now()), 100)
        return () => clearInterval(id)
    }, [state.phase])

    // Auto-acquire when game starts, release when returning to setup
    const { acquire, release } = wakeLock;
    useEffect(() => {
        if (state.phase === "playing") {
            acquire()
        } else if (state.phase === "setup") {
            release()
        }
    }, [state.phase, acquire, release])

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
                            {wakeLock.supported && (
                                <Button
                                    variant={wakeLock.enabled ? "default" : "outline"}
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={wakeLock.toggle}
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
