"use client"

import { useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup } from "./multi-select"
import { buildGameGroups } from "@/lib/game-groups"

export function GameMultiSelect({
  value,
  onChange,
}: {
  value: string[]
  onChange?: (ids: string[]) => void
}) {
  const { games } = useGames()
  const { matches } = useMatches()
  const { playerId } = useMe()

  const options: MultiSelectGroup[] = useMemo(
    () => buildGameGroups(games, matches, playerId),
    [games, matches, playerId]
  )

  return (
    <MultiSelect
      options={options}
      placeholder="Выберите игры"
      searchPlaceholder="Искать игру..."
      hideSelectAll={true}
      onValueChange={onChange ?? (() => {})}
      defaultValue={value}
    />
  )
}
