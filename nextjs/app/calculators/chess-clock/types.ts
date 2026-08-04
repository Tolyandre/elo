// Pure types, constants, and helpers for the chess-clock calculator.
// Extracted from page.tsx so the timer engine and presentational components
// can be unit-tested and reused independently.

export type PlayerConfig = { id: string; name: string; color: string };
export type TimerMode = "countdown" | "elapsed";

export type ChessClockState = {
    phase: "setup" | "playing" | "paused";
    players: PlayerConfig[];
    mode: TimerMode;
    initialTimeMs: number;
    incrementMs: number;
    activePlayerIndex: number;
    baseTimersMs: number[];
    turnsPlayed: number[];
    activeSince: number | null;
    totalBaseMs: number;
    totalSince: number | null;
};

export const LS_KEY = "chess-clock/state";

export const PLAYER_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#eab308",
    "#a855f7",
    "#f97316",
    "#ec4899",
    "#14b8a6",
];

export const COLOR_LABELS = [
    "Синий", "Красный", "Зелёный", "Жёлтый",
    "Фиолетовый", "Оранжевый", "Розовый", "Бирюзовый",
];

export const INITIAL_STATE: ChessClockState = {
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
};

export function formatTime(ms: number): string {
    const neg = ms < 0;
    const abs = Math.abs(ms);
    const totalSecs = Math.floor(abs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${neg ? "−" : ""}${mins}:${String(secs).padStart(2, "0")}`;
}

export function getTimerMs(state: ChessClockState, i: number, nowMs: number): number {
    const base = state.baseTimersMs[i];
    if (i !== state.activePlayerIndex || state.activeSince === null) return base;
    const elapsed = nowMs - state.activeSince;
    return state.mode === "countdown" ? base - elapsed : base + elapsed;
}

export function getTotalMs(state: ChessClockState, nowMs: number): number {
    if (state.totalSince === null) return state.totalBaseMs;
    return state.totalBaseMs + (nowMs - state.totalSince);
}
