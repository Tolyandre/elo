"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useEffect } from "react"
import { useState } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { buildPlayerGroups } from "@/lib/player-groups"



export function PlayerMultiSelect({
  value: controlledValue,
  onChange,
}: {
  value: string[]
  onChange?: (ids: string[]) => void
}) {
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>(controlledValue || [])
  const [options, setOptions] = useState<MultiSelectOption[] | MultiSelectGroup[]>([])
  const [recentPlayerIds, setRecentPlayerIds] = useState<string[]>([])
  const { players } = usePlayers()
  const { matches } = useMatches()
  const { clubs } = useClubs()

  useEffect(() => {
    setRecentPlayerIds(
      Array.from(
        new Set(
          matches
            ?.toSorted((a, b) => a.date == b.date ? 0 : (new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()))
            ?.slice(0, 5)
            .flatMap(m => Object.keys(m.score))
        )
      ).slice(0, 8)
        .sort((a, b) => a.localeCompare(b))
    )
  }, [matches])

  useEffect(() => {
    setOptions(buildPlayerGroups(players, clubs, recentPlayerIds))
  }, [players, clubs, recentPlayerIds]);

  const handleSelect = (currentValue: string[]) => {
    setSelectedPlayerIds(currentValue);
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
    defaultValue={selectedPlayerIds} />
}
