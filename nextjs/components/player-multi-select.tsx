"use client"

import { usePlayers } from "@/app/players/PlayersContext"
import { useCallback, useMemo, useRef, useState } from "react"
import { MultiSelect, MultiSelectGroup, MultiSelectOption, MultiSelectTab } from "./multi-select"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useTournaments } from "@/app/tournamentsContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { buildPlayerGroups, buildPlayerTabs, recentCoPlayerIds } from "@/lib/player-groups"
import { ClubIcon } from "@/components/club-icon"
import { ClubIcons } from "@/components/player-name"
import { AddPlayerForm, AddPlayerFormHandle } from "@/components/add-player-form"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

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
  const { playerId: myPlayerId, canEdit } = useMe()
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

  // Inline "create player": shown as a button under the empty search state.
  // Clicking it opens a confirmation dialog (name pre-filled with the search,
  // clubs selectable); on confirm the player is created and auto-selected.
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [creating, setCreating] = useState(false)
  const formRef = useRef<AddPlayerFormHandle>(null)

  const openCreate = useCallback((search: string) => {
    setCreateName(search)
    setCreateOpen(true)
  }, [])

  const handleCreated = useCallback((playerId: string) => {
    if (controlledValue.includes(playerId)) return
    onChange?.([...controlledValue, playerId])
  }, [controlledValue, onChange])

  async function confirmCreate() {
    if (creating) return
    setCreating(true)
    try {
      const result = await formRef.current?.submit()
      if (result?.created) {
        setCreateOpen(false)
      }
    } finally {
      setCreating(false)
    }
  }

  const emptyFooter = useCallback((search: string) => {
    if (!canEdit || !search.trim()) return null
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center"
        onClick={() => openCreate(search)}
      >
        <UserPlus className="size-4" />
        Добавить «{search.trim()}»
      </Button>
    )
  }, [canEdit, openCreate])

  return (
    <>
      <MultiSelect
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
        defaultValue={controlledValue}
        emptyFooter={emptyFooter}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый игрок</DialogTitle>
            <DialogDescription>
              Проверьте имя и при необходимости выберите клубы.
            </DialogDescription>
          </DialogHeader>
          <AddPlayerForm
            ref={formRef}
            hideSubmit
            initialName={createName}
            autoFocus
            onCreated={handleCreated}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Отмена
            </Button>
            <Button onClick={confirmCreate} disabled={creating} aria-busy={creating}>
              {creating && <Spinner className="size-4" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
