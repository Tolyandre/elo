"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

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
import { useGames } from "@/app/gamesContext"
import { createGamePromise } from "@/app/api"

export function GameCombobox({
  value: controlledValue,
  onChange,
}: {
  value?: string
  onChange?: (id?: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const value = controlledValue !== undefined ? controlledValue : internalValue

  const { games, invalidate } = useGames();

  const handleCreateGame = async () => {
    if (!searchQuery.trim() || creating) return;

    setCreating(true);
    try {
      const newGame = await createGamePromise({ name: searchQuery.trim() });
      invalidate();

      // Wait a bit for context to update
      setTimeout(() => {
        if (controlledValue === undefined) {
          setInternalValue(newGame.id);
        }
        if (onChange) {
          onChange(newGame.id);
        }
        setOpen(false);
        setSearchQuery("");
        setCreating(false);
      }, 100);
    } catch (err) {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value ? games.find((game) => game.id === value)?.name : "Игра..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Искать игру..."
            className="h-9"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>
              <div className="py-2 px-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sm"
                  onClick={handleCreateGame}
                  disabled={creating || !searchQuery.trim()}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {creating ? "Создание..." : `Создать "${searchQuery}"`}
                </Button>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {games
               .sort((a, b) => a.name > b.name ? 1 : -1)
               .map((game) => (
                <CommandItem
                  key={game.id}
                  value={game.id}
                  keywords={[game.name]}
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
