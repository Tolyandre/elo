"use client"
import type { Base58ID } from "@/lib/id";

import { useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useFavoriteGames } from "@/app/useFavoriteGames"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption, MultiSelectTab } from "./vendor/multi-select"
import { buildGameGroups, buildGameTabs, type GameGroup } from "@/lib/game-groups"
import { allNames, secondaryNames } from "@/lib/game-names"
import { GameImage } from "@/components/game-image"
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
  const favorites = useFavoriteGames()

  const visibleGames = useMemo(
    () => (filter ? games.filter(filter) : games),
    [games, filter],
  )

  // Browsing view: the «Избранные» / «Остальные» tabs.
  const tabs = useMemo<MultiSelectTab[]>(
    () =>
      buildGameTabs(visibleGames, matches, playerId, favorites).map((tab) => ({
        key: tab.key,
        label: tab.label,
        groups: toGroups(tab.sections),
      })),
    [visibleGames, matches, playerId, favorites]
  )

  // Search view: a flat grouped list spanning every game.
  const searchGroups = useMemo<MultiSelectGroup[]>(
    () => toGroups(buildGameGroups(visibleGames, matches, playerId, favorites)),
    [visibleGames, matches, playerId, favorites]
  )

  return (
    <MultiSelect
      options={searchGroups}
      tabs={tabs}
      placeholder="Выберите игры"
      searchPlaceholder="Искать игру..."
      hideSelectAll={true}
      onValueChange={(ids: string[]) => (onChange ?? (() => {}))(ids as Base58ID[])}
      defaultValue={value}
    />
  )
}
