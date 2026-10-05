"use client"
import type { Base58ID } from "@/lib/id";

import { useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup } from "./vendor/multi-select"
import { buildGameGroups } from "@/lib/game-groups"
import { allNames } from "@/lib/game-names"

export function GameMultiSelect({
  value,
  onChange,
}: {
  value: Base58ID[]
  onChange?: (ids: Base58ID[]) => void
}) {
  const { games } = useGames()
  const { matches } = useMatches()
  const { playerId } = useMe()

  const options: MultiSelectGroup[] = useMemo(
    () =>
      buildGameGroups(games, matches, playerId).map((group) => ({
        heading: group.heading,
        options: group.options.map((o) => ({
          label: o.label,
          value: o.value,
          // Search matches every name, not just the accent one.
          keywords: o.game ? allNames(o.game) : undefined,
        })),
      })),
    [games, matches, playerId]
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
