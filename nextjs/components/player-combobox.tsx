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
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { usePlayers } from "@/app/players/PlayersContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useClubs } from "@/app/clubsContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command"
import { buildPlayerGroups } from "@/lib/player-groups"

export function PlayerCombobox({
  value: controlledValue,
  onChange,
}: {
  value?: string
  onChange?: (id?: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")

  const value = controlledValue !== undefined ? controlledValue : internalValue
  const { isMobile } = useIsMobile()

  const { players } = usePlayers()
  const { matches } = useMatches()
  const { clubs } = useClubs()

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
    () => buildPlayerGroups(players, clubs, recentPlayerIds),
    [players, clubs, recentPlayerIds]
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
        ? players.find((player) => player.id === value)?.name ?? value
        : "Игрок..."}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  )

  const content = (
    <PlayerCommand
      value={value}
      groups={groups}
      onSelect={handleSelect}
    />
  )

  // 📱 MOBILE — Drawer
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="p-4">
          {content}
        </DrawerContent>
      </Drawer>
    )
  }

  // 🖥 DESKTOP — Popover
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-full p-0"
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
}

function PlayerCommand({ value, groups, onSelect }: PlayerCommandProps) {
  return (
    <Command>
      <CommandInput placeholder="Искать игрока..." className="h-9" />

      <CommandList className="max-h-[40dvh] overflow-y-auto">
        <CommandEmpty>Игрок не найден.</CommandEmpty>

        {groups.map((group, i) => (
          <React.Fragment key={group.heading}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.options.map((player) => (
                <CommandItem
                  key={`${group.heading}-${player.value}`}
                  value={player.value}
                  keywords={[player.label]}
                  onSelect={onSelect}
                >
                  {player.label}
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
