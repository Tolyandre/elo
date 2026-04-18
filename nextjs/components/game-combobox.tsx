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
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { useGames } from "@/app/gamesContext"
import { createGamePromise } from "@/app/api"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { buildGameGroups } from "@/lib/game-groups"

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
  const { matches } = useMatches();
  const { playerId } = useMe();
  const { isMobile } = useIsMobile();

  const groups = React.useMemo(
    () => buildGameGroups(games, matches, playerId),
    [games, matches, playerId]
  );

  const handleSelect = (currentValue: string) => {
    const next = currentValue === value ? "" : currentValue;
    if (controlledValue === undefined) {
      setInternalValue(next);
    }
    onChange?.(next === "" ? undefined : next);
    setOpen(false);
  };

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

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-full justify-between"
    >
      {value ? games.find((game) => game.id === value)?.name : "Игра..."}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  )

  const mobileListClass = isMobile ? "flex-1 min-h-0 overflow-y-auto max-h-none" : undefined

  const content = (
    <Command shouldFilter={true} className={isMobile ? "flex flex-col flex-1 min-h-0" : undefined}>
      <CommandInput
        placeholder="Искать игру..."
        className="h-9"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className={mobileListClass}>
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
        {groups.map((group, i) => (
          <React.Fragment key={group.heading || "__only__"}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading || undefined}>
              {group.options.map((game) => (
                <CommandItem
                  key={`${group.heading}-${game.value}`}
                  value={game.value}
                  keywords={[game.label]}
                  onSelect={handleSelect}
                >
                  {game.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === game.value ? "opacity-100" : "opacity-0"
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
          {value ? games.find((game) => game.id === value)?.name : "Игра..."}
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
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        {content}
      </PopoverContent>
    </Popover>
  )
}
