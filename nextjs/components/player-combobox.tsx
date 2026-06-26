"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useMe } from "@/app/meContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command"
import { ClubIcon } from "@/components/club-icon"
import { ClubIcons } from "@/components/player-name"
import { buildPlayerTabs, recentCoPlayerIds, PlayerTab } from "@/lib/player-groups"

type Option = { value: string; label: string }

export function PlayerCombobox({
  value: controlledValue,
  onChange,
  allowClear = false,
}: {
  value?: string
  onChange?: (id?: string) => void
  allowClear?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")

  const value = controlledValue !== undefined ? controlledValue : internalValue
  const { isMobile } = useIsMobile()

  const { players, playerDisplayName } = usePlayers()
  const { matches } = useMatches()
  const { clubs, clubDisplayName } = useClubs()
  const { playerId: myPlayerId } = useMe()

  const recentPlayerIds = React.useMemo(
    () => recentCoPlayerIds(matches, myPlayerId),
    [matches, myPlayerId]
  )

  const tabs = React.useMemo(
    () => buildPlayerTabs(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId),
    [players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName, myPlayerId]
  )

  // Flat, de-duplicated, name-sorted list used while searching (search spans all players).
  const allOptions = React.useMemo<Option[]>(
    () => [...players]
      .sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" }))
      .map((p) => ({ value: p.id, label: playerDisplayName(p) })),
    [players, playerDisplayName]
  )

  const handleSelect = (currentValue: string) => {
    const next = currentValue === value ? "" : currentValue

    if (controlledValue === undefined) {
      setInternalValue(next)
    }

    onChange?.(next === "" ? undefined : next)
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
      allOptions={allOptions}
      onSelect={handleSelect}
      listClassName={mobileListClass}
      allowClear={allowClear}
      onClear={allowClear ? () => { onChange?.(undefined); if (controlledValue === undefined) setInternalValue(""); setOpen(false); } : undefined}
    />
  )

  // 📱 MOBILE — BottomSheet
  if (isMobile) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          onClick={() => setOpen(true)}
        >
          {selectedLabel}
          <ChevronsUpDown className="opacity-50" />
        </Button>
        <BottomSheet open={open} onOpenChange={setOpen}>
          <div className="px-4 pb-4 flex flex-col flex-1 min-h-0 overflow-hidden">
            {content}
          </div>
        </BottomSheet>
      </>
    )
  }

  // 🖥 DESKTOP — Popover
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        side="bottom"
        align="start"
        avoidCollisions={false}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

type PlayerCommandProps = {
  value: string
  tabs: PlayerTab[]
  allOptions: Option[]
  onSelect: (value: string) => void
  listClassName?: string
  allowClear?: boolean
  onClear?: () => void
}

function PlayerCommand({ value, tabs, allOptions, onSelect, listClassName, allowClear, onClear }: PlayerCommandProps) {
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
        ? <span className="bg-blue-100 dark:bg-blue-900/40 rounded px-1">{option.label}</span>
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
          ? <CommandGroup>{allOptions.map((o) => renderItem(o, "search"))}</CommandGroup>
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
