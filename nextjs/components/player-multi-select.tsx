"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useMe } from "@/app/meContext"
import { buildPlayerGroups } from "@/lib/player-groups"



export function PlayerMultiSelect({
  value: controlledValue,
  onChange,
}: {
  value: string[]
  onChange?: (ids: string[]) => void
}) {
  const { players, playerDisplayName } = usePlayers()
  const { matches } = useMatches()
  const { clubs, clubDisplayName } = useClubs()
  const { playerId: myPlayerId } = useMe()

  const recentPlayerIds = useMemo(() => (
    Array.from(
      new Set(
        matches
          ?.toSorted((a, b) => a.date == b.date ? 0 : (new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()))
          ?.slice(0, 5)
          .flatMap(m => Object.keys(m.score))
      )
    ).slice(0, 8)
  ), [matches])

  const options: MultiSelectOption[] | MultiSelectGroup[] = useMemo(
    () => buildPlayerGroups(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName).map(group => ({
      ...group,
      options: group.options.map(opt => opt.value === myPlayerId
        ? { ...opt, render: <span className="bg-blue-100 dark:bg-blue-900/40 rounded px-1">{opt.label}</span> }
        : opt
      ),
    })),
    [players, clubs, recentPlayerIds, myPlayerId, playerDisplayName, clubDisplayName]
  )

  const handleSelect = (currentValue: string[]) => {
    onChange?.(currentValue);
  }

  return <MultiSelect options={options}
    allowDuplicateValues={true}
    responsive={{
      mobile: { maxCount: 10, hideIcons: false, compactMode: true },
      tablet: { maxCount: 10, hideIcons: false, compactMode: false },
      desktop: { maxCount: 10, hideIcons: false, compactMode: false },
    }}
    placeholder="Выберите игроков"
    searchPlaceholder="Искать игрока..."
    hideSelectAll={true}
    onValueChange={handleSelect}
    maxCount={10}
    defaultValue={controlledValue} />
}
