"use client"

import * as React from "react"
import { X } from "lucide-react"

import { suggestGamesPromise, type GameSuggestion } from "@/app/api"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/** Metadata carried into game creation from an accepted suggestion. */
export type AcceptedGameSuggestion = {
    /** The chip label as rendered when picked — the accepted pill shows it verbatim. */
    label: string
    nameEn: string | null
    nameRu: string | null
    bggRef: number | null
    teseraRef: number | null
}

export function suggestionMeta(s: GameSuggestion): AcceptedGameSuggestion {
    return {
        label: suggestionLabel(s),
        nameEn: s.name_en ?? null,
        nameRu: s.name_ru ?? null,
        bggRef: s.bgg_ref ?? null,
        teseraRef: s.tesera_ref ?? null,
    }
}

/**
 * Debounced catalogue lookups for a name being typed. Failures resolve to an
 * empty list inside suggestGamesPromise, so suggestions never block creation;
 * `failed` distinguishes that from a genuine no-match, and the
 * *_unavailable flags say which catalogue is out.
 */
export type GameSuggestions = {
    suggestions: GameSuggestion[]
    loading: boolean
    failed: boolean
    teseraUnavailable: boolean
    bggUnavailable: boolean
}

const NO_SUGGESTIONS: GameSuggestions = {
    suggestions: [],
    loading: false,
    failed: false,
    teseraUnavailable: false,
    bggUnavailable: false,
}

export function useGameSuggestions(name: string, enabled: boolean): GameSuggestions {
    const trimmed = name.trim()
    const [state, setState] = React.useState<(GameSuggestions & { query: string })>({ ...NO_SUGGESTIONS, query: "" })
    React.useEffect(() => {
        if (!enabled || trimmed.length < 2) {
            return
        }
        let cancelled = false
        const timer = setTimeout(() => {
            suggestGamesPromise(trimmed).then(({ games, teseraUnavailable, bggUnavailable, failed }) => {
                if (!cancelled) {
                    setState({ query: trimmed, suggestions: games, loading: false, failed, teseraUnavailable, bggUnavailable })
                }
            })
        }, 350)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [trimmed, enabled])
    // Derived view: a stored answer for some other query (or none yet) means
    // a search for the current one is pending — the debounce window counts
    // as loading too, so the picker says "searching" from the first
    // qualifying keystroke, and a previous query's results never show.
    if (!enabled || trimmed.length < 2) {
        return NO_SUGGESTIONS
    }
    if (state.query !== trimmed) {
        return { ...NO_SUGGESTIONS, loading: true }
    }
    return state
}

/** Suggestions are keyed by whichever catalogue id identifies the row. */
export function suggestionKey(s: GameSuggestion): string {
    return s.bgg_ref != null ? `bgg-${s.bgg_ref}` : `tesera-${s.tesera_ref}`
}

export function suggestionLabel(s: GameSuggestion): string {
    const parts = [s.title]
    if (s.name_en && s.name_en !== s.title) parts.push(s.name_en)
    // Both canonical names ride in the chip itself — the picker decides by
    // them — so there is no separate accepted-state meta line.
    if (s.name_ru && !parts.includes(s.name_ru)) parts.push(s.name_ru)
    let label = parts.filter(Boolean).join(" · ")
    if (s.year) label += ` (${s.year})`
    // Tesera's addition flag is unreliable, so additions are marked rather
    // than hidden — the user decides in the picker.
    return s.is_addition ? `${label} · дополнение` : label
}

/**
 * One clickable catalogue match — the shared chip style for every BGG/Tesera
 * picker. Additions are dimmed in addition to their «дополнение» label: the
 * flag is unreliable, so the user decides, but the hint steers the eye.
 */
export function GameSuggestionChip({
    suggestion,
    onPick,
}: {
    suggestion: GameSuggestion
    onPick: (s: GameSuggestion) => void
}) {
    return (
        <button
            type="button"
            onClick={() => onPick(suggestion)}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent text-left",
                suggestion.is_addition && "opacity-70",
            )}
        >
            {suggestionLabel(suggestion)}
        </button>
    )
}

/**
 * The catalogue-status hints: a search in progress, a failed search, and the
 * per-catalogue degradation. Shared by every BGG/Tesera picker so the
 * wording stays identical; a degraded catalogue is not an error, and a
 * search in progress is not "no results".
 */
export function GameSuggestionsStatus({
    loading,
    failed,
    teseraUnavailable,
    bggUnavailable,
}: {
    loading?: boolean
    failed?: boolean
    teseraUnavailable?: boolean
    bggUnavailable?: boolean
}) {
    return (
        <>
            {loading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                    <Spinner className="size-3" />
                    Ищем в каталогах…
                </p>
            )}
            {failed && !loading && (
                <p className="text-xs text-warning">
                    Каталоги недоступны — не удалось выполнить поиск.
                </p>
            )}
            {teseraUnavailable && (
                <p className="text-xs text-warning">
                    Каталог Tesera недоступен — показаны результаты BoardGameGeek.
                </p>
            )}
            {bggUnavailable && (
                <p className="text-xs text-warning">
                    BoardGameGeek недоступен — показаны результаты Tesera.
                </p>
            )}
        </>
    )
}

/**
 * Clickable catalogue matches: one is "accepted" (highlighted, removable);
 * accepting fills the canonical names and external links. The loading,
 * failed, and unavailable flags render as hints — a degraded catalogue is
 * not an error, and a search in progress is not "no results".
 */
export function GameSuggestionChips({
    suggestions,
    accepted,
    onAccept,
    onClear,
    loading,
    failed,
    teseraUnavailable,
    bggUnavailable,
}: {
    suggestions: GameSuggestion[]
    accepted: AcceptedGameSuggestion | null
    onAccept: (s: GameSuggestion) => void
    onClear: () => void
    loading?: boolean
    failed?: boolean
    teseraUnavailable?: boolean
    bggUnavailable?: boolean
}) {
    if (suggestions.length === 0 && !accepted && !loading && !failed && !teseraUnavailable && !bggUnavailable) return null
    return (
        <div className="flex flex-col gap-1">
            <GameSuggestionsStatus
                loading={loading}
                failed={failed}
                teseraUnavailable={teseraUnavailable}
                bggUnavailable={bggUnavailable}
            />
            {/* The header names the linking action, so it stays with the
                accepted pill too — not just over the candidate list. */}
            {!loading && (suggestions.length > 0 || accepted) && (
                <p className="text-xs text-muted-foreground">Привязать к BGG / Tesera</p>
            )}
            <div className="flex flex-wrap gap-1 items-center">
                {accepted ? (
                    <button
                        type="button"
                        onClick={onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary text-primary-foreground px-2 py-0.5 text-xs"
                        title="Убрать подобранную игру"
                    >
                        {accepted.label || accepted.nameRu || accepted.nameEn || "Подобрано"}
                        <X className="size-3" />
                    </button>
                ) : (
                    suggestions.map((s) => (
                        <GameSuggestionChip key={suggestionKey(s)} suggestion={s} onPick={onAccept} />
                    ))
                )}
            </div>
        </div>
    )
}
