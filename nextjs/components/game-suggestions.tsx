"use client"

import * as React from "react"
import { Check, X } from "lucide-react"

import { suggestGamesPromise, type GameSuggestion } from "@/app/api"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/** Metadata carried into game creation from an accepted suggestion. */
export type AcceptedGameSuggestion = {
    nameEn: string | null
    nameRu: string | null
    bggRef: number | null
    teseraRef: number | null
}

export function suggestionMeta(s: GameSuggestion): AcceptedGameSuggestion {
    return {
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
    let label = parts.filter(Boolean).join(" · ")
    if (s.year) label += ` (${s.year})`
    // Tesera's addition flag is unreliable, so additions are marked rather
    // than hidden — the user decides in the picker.
    return s.is_addition ? `${label} · дополнение` : label
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
            {loading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                    <Spinner className="size-3" />
                    Ищем в каталогах…
                </p>
            )}
            {!accepted && !loading && suggestions.length > 0 && (
                <p className="text-xs text-muted-foreground">Нашли в каталогах:</p>
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
            <div className="flex flex-wrap gap-1 items-center">
                {accepted ? (
                    <button
                        type="button"
                        onClick={onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary text-primary-foreground px-2 py-0.5 text-xs"
                        title="Убрать подобранную игру"
                    >
                        {accepted.nameRu || accepted.nameEn || "Подобрано"}
                        <X className="size-3" />
                    </button>
                ) : (
                    suggestions.slice(0, 5).map((s) => (
                        <button
                            key={suggestionKey(s)}
                            type="button"
                            onClick={() => onAccept(s)}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent text-left"
                        >
                            <Check className="size-3 shrink-0 opacity-40" />
                            {suggestionLabel(s)}
                        </button>
                    ))
                )}
            </div>
        </div>
    )
}

/** Compact preview of the metadata an accepted suggestion will store. */
export function AcceptedMetaLine({ accepted }: { accepted: AcceptedGameSuggestion }) {
    const bits: string[] = []
    if (accepted.nameEn) bits.push(accepted.nameEn)
    if (accepted.nameRu && accepted.nameRu !== accepted.nameEn) bits.push(accepted.nameRu)
    if (accepted.bggRef) bits.push("BGG")
    if (accepted.teseraRef) bits.push("Тесера")
    if (bits.length === 0) return null
    return <p className={cn("text-xs text-muted-foreground")}>Ссылки и названия: {bits.join(" · ")}</p>
}
