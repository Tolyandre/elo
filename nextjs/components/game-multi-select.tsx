"use client"
import type { Base58ID } from "@/lib/id";

import { useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup } from "./vendor/multi-select"
import { buildGameGroups } from "@/lib/game-groups"
import { allNames } from "@/lib/game-names"
import type { GameListItem } from "@/app/api"

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

  const visibleGames = useMemo(
    () => (filter ? games.filter(filter) : games),
    [games, filter],
  )

  const options: MultiSelectGroup[] = useMemo(
    () =>
      buildGameGroups(visibleGames, matches, playerId).map((group) => ({
        heading: group.heading,
        options: group.options.map((o) => ({
          label: o.label,
          value: o.value,
          // Search matches every name, not just the accent one.
          keywords: o.game ? allNames(o.game) : undefined,
        })),
      })),
    [visibleGames, matches, playerId]
  )

  return (
    <MultiSelect
      options={options}
      placeholder="Выберите игры"
      searchPlaceholder="Искать игру..."
      hideSelectAll={true}
      onValueChange={(ids: string[]) => (onChange ?? (() => {}))(ids as Base58ID[])}
      defaultValue={value}
    />
  )
}
