"use client"
import type { Base58ID } from "@/lib/id";

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResponsiveCommandPopover } from "@/components/responsive-command-popover"
import { usePlayers } from "@/app/players/PlayersContext"
import { useClubs } from "@/app/clubsContext"
import { useMe } from "@/app/meContext"
import { useRecentPlayerIds } from "@/app/players/useRecentPlayerIds"
import useIsMobile from "@/hooks/use-is-mobile"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command"
import { ClubIcon } from "@/components/club-icon"
import { ClubIcons } from "@/components/player-name"
import { buildPlayerGroups, buildPlayerTabs, PlayerTab } from "@/lib/player-groups"

type Option = { value: string; label: string }

export function PlayerCombobox({
  value: controlledValue,
  onChange,
  allowClear = false,
  allowedPlayerIds,
}: {
  value?: Base58ID
  onChange?: (id?: Base58ID) => void
  allowClear?: boolean
  /**
   * When set, only these players are offered. The membership rules on the
   * creation forms pass the tenant's member set (ADR-36).
   */
  allowedPlayerIds?: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")

  const value = controlledValue !== undefined ? controlledValue : internalValue
  const { isMobile } = useIsMobile()

  const { players, playerDisplayName } = usePlayers()
  const { clubs, clubDisplayName } = useClubs()
  const { playerId: myPlayerId } = useMe()

  const recentPlayerIds = useRecentPlayerIds()

  const allowedSet = React.useMemo(
    () => (allowedPlayerIds ? new Set(allowedPlayerIds) : null),
    [allowedPlayerIds],
  )
  const visiblePlayers = React.useMemo(
    () => (allowedSet ? players.filter((p) => allowedSet.has(p.id)) : players),
    [players, allowedSet],
  )

  const tabs = React.useMemo(
    () => buildPlayerTabs(visiblePlayers, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId),
    [visiblePlayers, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId]
  )

  // Search view: the same grouped sections as the multi-select's search —
  // Недавние, camps (none here), the current user's clubs, then other clubs,
  // then club-less players. cmdk hides the groups whose players don't match.
  const searchGroups = React.useMemo(
    () => buildPlayerGroups(visiblePlayers, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, [], myPlayerId),
    [visiblePlayers, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId]
  )

  // cmdk hands us the raw string; it is one of the ids we put into the items.
  const handleSelect = (currentValue: string) => {
    const next = currentValue === value ? "" : currentValue

    if (controlledValue === undefined) {
      setInternalValue(next)
    }

    onChange?.(next === "" ? undefined : (next as Base58ID))
    setOpen(false)
  }

  const selectedLabel = value
    ? (() => { const p = players.find((player) => player.id === value); return p ? playerDisplayName(p) : value })()
    : "Игрок..."

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-full justify-between"
    >
      {selectedLabel}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  )

  const mobileListClass = isMobile ? "flex-1 min-h-0 overflow-y-auto max-h-none" : undefined

  const content = (
    <PlayerCommand
      value={value}
      tabs={tabs}
      searchGroups={searchGroups}
      onSelect={handleSelect}
      listClassName={mobileListClass}
      allowClear={allowClear}
      onClear={allowClear ? () => { onChange?.(undefined); if (controlledValue === undefined) setInternalValue(""); setOpen(false); } : undefined}
    />
  )

  return (
    <ResponsiveCommandPopover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      content={content}
    />
  )
}

type PlayerCommandProps = {
  value: string
  tabs: PlayerTab[]
  searchGroups: PlayerTab["sections"]
  onSelect: (value: string) => void
  listClassName?: string
  allowClear?: boolean
  onClear?: () => void
}

function PlayerCommand({ value, tabs, searchGroups, onSelect, listClassName, allowClear, onClear }: PlayerCommandProps) {
  const { playerId } = useMe()
  const [search, setSearch] = React.useState("")
  const [activeTab, setActiveTab] = React.useState<string | undefined>(tabs[0]?.key)

  const activeKey = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]?.key
  const current = tabs.find((t) => t.key === activeKey)
  const searching = search.trim().length > 0

  const renderItem = (option: Option, keyPrefix: string) => (
    <CommandItem
      key={`${keyPrefix}-${option.value}`}
      value={option.value}
      keywords={[option.label]}
      onSelect={onSelect}
    >
      <ClubIcons playerId={option.value} />
      {option.value === playerId
        ? <span className="bg-info/10 rounded px-1">{option.label}</span>
        : option.label}
      <Check className={cn("ml-auto", value === option.value ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  )

  return (
    <Command className={listClassName ? "flex flex-col flex-1 min-h-0" : undefined}>
      <CommandInput placeholder="Искать игрока..." className="h-9" value={search} onValueChange={setSearch} />

      {!searching && tabs.length > 1 && (
        <Tabs value={activeKey} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full h-auto flex-wrap justify-start gap-1 px-1">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="flex-none shrink-0 gap-1 whitespace-nowrap">
                {tab.club && <ClubIcon club={tab.club} />}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <CommandList className={listClassName}>
        <CommandEmpty>Игрок не найден.</CommandEmpty>

        {allowClear && value && (
          <CommandGroup>
            <CommandItem value="__clear__" onSelect={onClear}>
              Убрать привязку
            </CommandItem>
          </CommandGroup>
        )}

        {searching
          ? searchGroups.map((section, i) => (
              <React.Fragment key={section.heading || `s${i}`}>
                {i > 0 && <CommandSeparator />}
                <CommandGroup heading={section.heading || undefined}>
                  {section.options.map((o) => renderItem(o, `search-${i}`))}
                </CommandGroup>
              </React.Fragment>
            ))
          : current?.sections.map((section, i) => (
              <React.Fragment key={section.heading || `s${i}`}>
                {i > 0 && <CommandSeparator />}
                <CommandGroup heading={section.heading || undefined}>
                  {section.options.map((o) => renderItem(o, `${activeKey}-${i}`))}
                </CommandGroup>
              </React.Fragment>
            ))}
      </CommandList>
    </Command>
  )
}
