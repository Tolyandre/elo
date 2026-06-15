"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useMemo } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useTournaments } from "@/app/tournamentsContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { buildPlayerGroups } from "@/lib/player-groups"



export function PlayerMultiSelect({
  value: controlledValue,
  onChange,
  activeTournamentIds = [],
}: {
  value: string[]
  onChange?: (ids: string[]) => void
  /** Tournament IDs (checked in the match form) whose participants get their own section. */
  activeTournamentIds?: string[]
}) {
  const { players, playerDisplayName } = usePlayers()
  const { matches } = useMatches()
  const { clubs, clubDisplayName } = useClubs()
  const { tournaments } = useTournaments()
  const { playerId: myPlayerId } = useMe()
  const { pendingPlayers } = useOffline()

  // "Недавние" = players from my own most recent matches, not just any latest matches.
  const recentPlayerIds = useMemo(() => (
    Array.from(
      new Set(
        matches
          ?.filter(m => myPlayerId == null || Object.keys(m.score).includes(myPlayerId))
          ?.toSorted((a, b) => a.date == b.date ? 0 : (new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()))
          ?.slice(0, 5)
          .flatMap(m => Object.keys(m.score))
      )
    ).slice(0, 8)
  ), [matches, myPlayerId])

  const checkedTournaments = useMemo(
    () => tournaments.filter(t => activeTournamentIds.includes(t.id)),
    [tournaments, activeTournamentIds],
  )

  const options: MultiSelectOption[] | MultiSelectGroup[] = useMemo(() => {
    const groups: MultiSelectGroup[] = buildPlayerGroups(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, checkedTournaments, myPlayerId).map(group => ({
      ...group,
      options: group.options.map(opt => opt.value === myPlayerId
        ? { ...opt, render: <span className="bg-blue-100 dark:bg-blue-900/40 rounded px-1">{opt.label}</span> }
        : opt
      ),
    }))
    if (pendingPlayers.length > 0) {
      groups.unshift({
        heading: "Офлайн (не сохранено)",
        options: pendingPlayers.map(p => ({ value: p.clientId, label: `${p.name} (офлайн)` })),
      })
    }
    return groups
  }, [players, clubs, recentPlayerIds, myPlayerId, playerDisplayName, clubDisplayName, checkedTournaments, pendingPlayers])

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
