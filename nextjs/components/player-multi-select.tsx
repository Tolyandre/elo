"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useCallback, useMemo } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption, MultiSelectTab } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useTournaments } from "@/app/tournamentsContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { buildPlayerGroups, buildPlayerTabs, recentCoPlayerIds } from "@/lib/player-groups"
import { ClubIcon } from "@/components/club-icon"
import { ClubIcons } from "@/components/player-name"

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

  // "Недавние" = the last players from my own most recent matches.
  const recentPlayerIds = useMemo(
    () => recentCoPlayerIds(matches, myPlayerId),
    [matches, myPlayerId],
  )

  const checkedTournaments = useMemo(
    () => tournaments.filter(t => activeTournamentIds.includes(t.id)),
    [tournaments, activeTournamentIds],
  )

  // Renders club icons + name, highlighting the current user's own player.
  const toOption = useCallback((o: { value: string; label: string }): MultiSelectOption => ({
    value: o.value,
    label: o.label,
    render: (
      <span className="inline-flex items-center gap-1 min-w-0">
        <ClubIcons playerId={o.value} />
        {o.value === myPlayerId
          ? <span className="bg-blue-100 dark:bg-blue-900/40 rounded px-1">{o.label}</span>
          : <span>{o.label}</span>}
      </span>
    ),
  }), [myPlayerId])

  const offlineGroup = useMemo<MultiSelectGroup | null>(() => (
    pendingPlayers.length > 0
      ? { heading: "Офлайн (не сохранено)", options: pendingPlayers.map(p => ({ value: p.clientId, label: `${p.name} (офлайн)` })) }
      : null
  ), [pendingPlayers])

  // Browsing view: one tab per "Недавние" / club / "Другие" (+ pending players).
  const tabs = useMemo<MultiSelectTab[]>(() => {
    const built = buildPlayerTabs(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId, checkedTournaments)
      .map<MultiSelectTab>(tab => ({
        key: tab.key,
        label: tab.label,
        labelNode: tab.club
          ? <span className="inline-flex items-center gap-1"><ClubIcon club={tab.club} />{tab.label}</span>
          : undefined,
        groups: tab.sections.map(s => ({ heading: s.heading, options: s.options.map(toOption) })),
      }))
    if (offlineGroup) {
      built.push({ key: "offline", label: "Офлайн", groups: [offlineGroup] })
    }
    return built
  }, [players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId, checkedTournaments, toOption, offlineGroup])

  // Search view: a flat grouped list spanning every player (+ pending players).
  const searchGroups = useMemo<MultiSelectGroup[]>(() => {
    const groups = buildPlayerGroups(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, checkedTournaments, myPlayerId)
      .map(group => ({ heading: group.heading, options: group.options.map(toOption) }))
    if (offlineGroup) groups.unshift(offlineGroup)
    return groups
  }, [players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, checkedTournaments, myPlayerId, toOption, offlineGroup])

  const handleSelect = (currentValue: string[]) => {
    onChange?.(currentValue);
  }

  return <MultiSelect
    options={searchGroups}
    tabs={tabs}
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
