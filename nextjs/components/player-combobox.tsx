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
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import { useMe } from "@/app/meContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command"
import { buildPlayerGroups } from "@/lib/player-groups"

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

  const recentPlayerIds = React.useMemo(() => (
    Array.from(
      new Set(
        matches
          ?.toSorted((a, b) => a.date == b.date ? 0 : (new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()))
          ?.slice(0, 5)
          .flatMap(m => Object.keys(m.score))
      )
    ).slice(0, 8)
  ), [matches])

  const groups = React.useMemo(
    () => buildPlayerGroups(players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName),
    [players, clubs, recentPlayerIds, playerDisplayName, clubDisplayName]
  )

  const handleSelect = (currentValue: string) => {
    const next = currentValue === value ? "" : currentValue

    if (controlledValue === undefined) {
      setInternalValue(next)
    }

    onChange?.(next === "" ? undefined : next)
    setOpen(false)
  }

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-full justify-between"
    >
      {value
        ? (() => { const p = players.find((player) => player.id === value); return p ? playerDisplayName(p) : value; })()
        : "Игрок..."}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  )

  const mobileListClass = isMobile ? "flex-1 min-h-0 overflow-y-auto max-h-none" : undefined

  const content = (
    <PlayerCommand
      value={value}
      groups={groups}
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
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          onClick={() => setOpen(true)}
        >
          {value
            ? (() => { const p = players.find((player) => player.id === value); return p ? playerDisplayName(p) : value; })()
            : "Игрок..."}
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
  groups: { heading: string; options: { value: string; label: string }[] }[]
  onSelect: (value: string) => void
  listClassName?: string
  allowClear?: boolean
  onClear?: () => void
}

function PlayerCommand({ value, groups, onSelect, listClassName, allowClear, onClear }: PlayerCommandProps) {
  const { playerId } = useMe()
  return (
    <Command className={listClassName ? "flex flex-col flex-1 min-h-0" : undefined}>
      <CommandInput placeholder="Искать игрока..." className="h-9" />

      <CommandList className={listClassName}>
        <CommandEmpty>Игрок не найден.</CommandEmpty>

        {allowClear && value && (
          <CommandGroup>
            <CommandItem value="__clear__" onSelect={onClear}>
              Убрать привязку
            </CommandItem>
          </CommandGroup>
        )}

        {groups.map((group, i) => (
          <React.Fragment key={group.heading}>
            {(i > 0 || (allowClear && value)) && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.options.map((player) => (
                <CommandItem
                  key={`${group.heading}-${player.value}`}
                  value={player.value}
                  keywords={[player.label]}
                  onSelect={onSelect}
                >
                  {player.value === playerId
                    ? <span className="bg-blue-100 dark:bg-blue-900/40 rounded px-1">{player.label}</span>
                    : player.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === player.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </Command>
  )
}
