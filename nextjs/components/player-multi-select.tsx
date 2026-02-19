"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useEffect } from "react"
import { useState } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"



export function PlayerMultiSelect({
  value: controlledValue,
  onChange,
}: {
  value: string[]
  onChange?: (ids: string[]) => void
}) {
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>(controlledValue || [])
  const [options, setOptions] = useState<MultiSelectOption[] | MultiSelectGroup[]>([])
  const [recentPlayers, setRecentPlayers] = useState<string[]>([])
  const { players } = usePlayers()
  const { matches } = useMatches()

  useEffect(() => {
    setRecentPlayers(
      Array.from(
        new Set(
          matches
            ?.toSorted((a, b) => a.date == b.date ? 0 : (new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()))
            ?.slice(0, 5) // не более последних 5 игр
            .flatMap(m => Object.keys(m.score)) // id игроков
        )
      ).slice(0, 8) // максимум 8 игроков
        .sort((a, b) => a.localeCompare(b))
    )
  }, [matches])

  useEffect(() => {
    setOptions([
      {
        heading: "Недавние",
        options: recentPlayers.map(id => ({
          value: id,
          label: players.find((pl) => pl.id === id)?.name ?? id
        }))
      },
      {
        heading: "Остальные",
        options:
          players
            .filter(p => !recentPlayers.includes(p.id))
            .map(p => ({
              value: p.id,
              label: p.name
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
      }
    ])
  }, [players, recentPlayers]);

  const handleSelect = (currentValue: string[]) => {
    setSelectedPlayerIds(currentValue);
    onChange?.(currentValue);
  }

  return <MultiSelect options={options}
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