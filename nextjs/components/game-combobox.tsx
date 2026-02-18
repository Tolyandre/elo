"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { usePlayers } from "@/app/players/PlayersContext"
import { useGames } from "@/app/gamesContext"

export function GameCombobox({
  value: controlledValue,
  onChange,
}: {
  value?: string
  onChange?: (id?: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")

  const value = controlledValue !== undefined ? controlledValue : internalValue

  const { games } = useGames();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          {value ? games.find((game) => game.id === value)?.name : "Игра..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Искать игру..." className="h-9" />
          <CommandList>
            <CommandEmpty>Игра не найдена.</CommandEmpty>
            <CommandGroup>
              {games
               .sort((a, b) => a.name > b.name ? 1 : -1)
               .map((game) => (
                <CommandItem
                  key={game.id}
                  value={game.id}
                  onSelect={(currentValue) => {
                    const next = currentValue === value ? "" : currentValue
                    if (controlledValue === undefined) {
                      setInternalValue(next)
                    }
                    if (onChange) {
                      onChange(next === "" ? undefined : next)
                    }
                    setOpen(false)
                  }}
                >
                  {game.name}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === game.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
