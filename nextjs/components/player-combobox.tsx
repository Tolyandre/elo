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
import useIsMobile from "@/hooks/use-is-mobile"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command"

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
      className="w-[200px] justify-between"
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
      players={players}
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
        className="w-[200px] p-0"
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
  players: { id: string; name: string }[]
  onSelect: (value: string) => void
}

function PlayerCommand({
  value,
  players,
  onSelect,
}: PlayerCommandProps) {
  return (
    <Command>
      <CommandInput placeholder="Искать игрока..." className="h-9" />

      <CommandList className="max-h-[40dvh] overflow-y-auto">
        <CommandEmpty>Игрок не найден.</CommandEmpty>

        <CommandGroup>
          {players.map((player) => (
            <CommandItem
              key={player.id}
              value={player.id}
              keywords={[player.name]}
              onSelect={onSelect}
            >
              {player.name}
              <Check
                className={cn(
                  "ml-auto",
                  value === player.id ? "opacity-100" : "opacity-0"
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
