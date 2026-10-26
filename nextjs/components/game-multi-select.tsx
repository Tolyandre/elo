"use client"
import type { Base58ID } from "@/lib/id";

import { useCallback, useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { useFavoriteGames } from "@/app/useFavoriteGames"
import { MultiSelect, MultiSelectGroup, MultiSelectOption, MultiSelectTab } from "./vendor/multi-select"
import { buildGameGroups, buildGameTabs, type GameGroup } from "@/lib/game-groups"
import { allNames, secondaryNames } from "@/lib/game-names"
import { GameImage } from "@/components/game-image"
import { GameCreateDialog } from "@/components/game-create-dialog"
import { Button } from "@/components/ui/button"
import type { GameListItem } from "@/app/api"

type GameOption = GameGroup["options"][number]

/** Search matches every name, not just the accent one. */
function toOption(o: GameOption): MultiSelectOption {
  return {
    label: o.label,
    value: o.value,
    keywords: o.game ? allNames(o.game) : undefined,
    // Same item look as the single combobox: box art, accent name, the
    // secondary names muted.
    render: o.game ? (
      <span className="inline-flex items-center gap-2 min-w-0">
        {o.game.image_thumb_url && (
          <GameImage src={o.game.image_thumb_url} alt="" className="size-7 shrink-0 rounded-sm" />
        )}
        <span className="min-w-0">
          <span className="mr-2 whitespace-nowrap">{o.label}</span>
          <span className="text-xs text-muted-foreground">
            {secondaryNames(o.game).join(" · ")}
          </span>
        </span>
      </span>
    ) : undefined,
  }
}

function toGroups(sections: GameGroup[]): MultiSelectGroup[] {
  return sections.map((section) => ({
    heading: section.heading,
    options: section.options.map(toOption),
  }))
}

export function GameMultiSelect({
  value,
  onChange,
  filter,
}: {
  value: Base58ID[]
  onChange?: (ids: Base58ID[]) => void
  /** Optional game filter — e.g. hiding coop-only games from market pickers (ADR-33). */
  filter?: (game: GameListItem) => boolean
}) {
  const { games } = useGames()
  const { matches } = useMatches()
  const { playerId } = useMe()
  const { pendingGames } = useOffline()
  const favorites = useFavoriteGames()

  const visibleGames = useMemo(
    () => (filter ? games.filter(filter) : games),
    [games, filter],
  )

  // Games created offline ride on top of both views — the same group the
  // single combobox shows, and what makes a just-created game render as a
  // selected badge before the sync lands it in the catalog. A pending coop
  // game is equally unusable in a rating picker (ADR-33).
  const offlineGroup = useMemo<MultiSelectGroup | null>(() => {
    const visiblePending = filter
      ? pendingGames.filter((g) => g.meta?.gameMode !== "coop")
      : pendingGames
    if (visiblePending.length === 0) return null
    return {
      heading: "Офлайн (не сохранено)",
      options: visiblePending.map((g) => ({ value: g.clientId, label: `${g.name} (офлайн)` })),
    }
  }, [pendingGames, filter])

  // Browsing view: the «Избранные» / «Остальные» tabs (+ pending games).
  const tabs = useMemo<MultiSelectTab[]>(() => {
    const built = buildGameTabs(visibleGames, matches, playerId, favorites).map((tab) => ({
      key: tab.key,
      label: tab.label,
      groups: toGroups(tab.sections),
    }))
    if (offlineGroup) built.push({ key: "offline", label: "Офлайн", groups: [offlineGroup] })
    return built
  }, [visibleGames, matches, playerId, favorites, offlineGroup])

  // Search view: a flat grouped list spanning every game (+ pending games).
  const searchGroups = useMemo<MultiSelectGroup[]>(() => {
    const groups = toGroups(buildGameGroups(visibleGames, matches, playerId, favorites))
    if (offlineGroup) groups.unshift(offlineGroup)
    return groups
  }, [visibleGames, matches, playerId, favorites, offlineGroup])

  // Inline "create game": a button under the empty search state opens the
  // shared confirm dialog; the created game is queued offline (its clientId
  // is the final server id) and auto-selected.
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")

  const openCreate = useCallback((search: string) => {
    setCreateName(search)
    setCreateOpen(true)
  }, [])

  const handleCreated = useCallback((gameId: Base58ID) => {
    if (value.includes(gameId)) return
    onChange?.([...value, gameId])
  }, [value, onChange])

  const emptyFooter = useCallback((search: string) => {
    if (!search.trim()) return null
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center"
        onClick={() => openCreate(search)}
      >
        <Plus className="size-4" />
        Добавить «{search.trim()}»
      </Button>
    )
  }, [openCreate])

  return (
    <>
      <MultiSelect
        options={searchGroups}
        tabs={tabs}
        placeholder="Выберите игры"
        searchPlaceholder="Искать игру..."
        hideSelectAll={true}
        onValueChange={(ids: string[]) => (onChange ?? (() => {}))(ids as Base58ID[])}
        defaultValue={value}
        emptyFooter={emptyFooter}
      />
      <GameCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={createName.trim()}
        onCreated={handleCreated}
      />
    </>
  )
}
