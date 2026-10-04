"use client"

import * as React from "react"
import { Check, X } from "lucide-react"

import { suggestGamesPromise, type GameSuggestion } from "@/app/api"
import { cn } from "@/lib/utils"

/** Metadata carried into game creation from an accepted suggestion. */
export type AcceptedGameSuggestion = {
    nameOriginal: string | null
    nameRu: string | null
    bggRef: number | null
    teseraRef: number | null
}

export function suggestionMeta(s: GameSuggestion): AcceptedGameSuggestion {
    return {
        nameOriginal: s.name_original ?? null,
        nameRu: s.name_ru ?? null,
        bggRef: s.bgg_ref ?? null,
        teseraRef: s.tesera_ref ?? null,
    }
}

/**
 * Debounced catalogue lookups for a name being typed. Failures resolve to an
 * empty list inside suggestGamesPromise, so suggestions never block creation.
 */
export function useGameSuggestions(name: string, enabled: boolean): GameSuggestion[] {
    const trimmed = name.trim()
    const [state, setState] = React.useState<{ query: string; suggestions: GameSuggestion[] }>({
        query: "",
        suggestions: [],
    })
    React.useEffect(() => {
        let cancelled = false
        const timer = setTimeout(() => {
            if (!enabled || trimmed.length < 2) {
                if (!cancelled) setState({ query: "", suggestions: [] })
                return
            }
            suggestGamesPromise(trimmed).then((suggestions) => {
                if (!cancelled) setState({ query: trimmed, suggestions })
            })
        }, 350)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [trimmed, enabled])
    // Suggestions for a previous query are never shown while typing.
    return state.query === trimmed ? state.suggestions : []
}

export function suggestionLabel(s: GameSuggestion): string {
    const parts = [s.title]
    if (s.name_original && s.name_original !== s.title) parts.push(s.name_original)
    let label = parts.filter(Boolean).join(" · ")
    if (s.year) label += ` (${s.year})`
    // Tesera's addition flag is unreliable, so additions are marked rather
    // than hidden — the user decides in the picker.
    return s.is_addition ? `${label} · дополнение` : label
}

/**
 * Clickable catalogue matches: one is "accepted" (highlighted, removable);
 * accepting fills the canonical names and external links.
 */
export function GameSuggestionChips({
    suggestions,
    accepted,
    onAccept,
    onClear,
}: {
    suggestions: GameSuggestion[]
    accepted: AcceptedGameSuggestion | null
    onAccept: (s: GameSuggestion) => void
    onClear: () => void
}) {
    if (suggestions.length === 0 && !accepted) return null
    return (
        <div className="flex flex-col gap-1">
            {!accepted && suggestions.length > 0 && (
                <p className="text-xs text-muted-foreground">Нашли в каталогах:</p>
            )}
            <div className="flex flex-wrap gap-1 items-center">
                {accepted ? (
                    <button
                        type="button"
                        onClick={onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary text-primary-foreground px-2 py-0.5 text-xs"
                        title="Убрать подобранную игру"
                    >
                        {accepted.nameRu || accepted.nameOriginal || "Подобрано"}
                        <X className="size-3" />
                    </button>
                ) : (
                    suggestions.slice(0, 5).map((s) => (
                        <button
                            key={s.tesera_ref}
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
    if (accepted.nameOriginal) bits.push(accepted.nameOriginal)
    if (accepted.nameRu && accepted.nameRu !== accepted.nameOriginal) bits.push(accepted.nameRu)
    if (accepted.bggRef) bits.push("BGG")
    if (accepted.teseraRef) bits.push("Тесера")
    if (bits.length === 0) return null
    return <p className={cn("text-xs text-muted-foreground")}>Ссылки и названия: {bits.join(" · ")}</p>
}
