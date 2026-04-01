"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer"
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { useClubs } from "@/app/clubsContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { NO_CLUB_ID, NO_CLUB_LABEL } from "@/lib/player-groups"

type ClubOption = { id: string; name: string }

/** value = null means "all clubs selected" */
export function ClubMultiSelect({
  value,
  onChange,
}: {
  value: string[] | null
  onChange: (ids: string[] | null) => void
}) {
  const { clubs, clubDisplayName } = useClubs()
  const { isMobile } = useIsMobile()
  const [open, setOpen] = React.useState(false)

  const options: ClubOption[] = React.useMemo(() => [
    ...[...clubs].sort((a, b) => clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" }))
      .map(c => ({ id: c.id, name: clubDisplayName(c) })),
    { id: NO_CLUB_ID, name: NO_CLUB_LABEL },
  ], [clubs, clubDisplayName])

  const selectedSet = React.useMemo(
    () => new Set(value ?? options.map(o => o.id)),
    [value, options]
  )

  const triggerLabel = React.useMemo(() => {
    if (value === null || selectedSet.size === options.length) return "Все"
    if (selectedSet.size === 0) return "Выберите клуб"
    return options.filter(o => selectedSet.has(o.id)).map(o => o.name).join(", ")
  }, [value, selectedSet, options])

  function toggle(id: string) {
    const next = new Set(selectedSet)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(next.size === options.length ? null : [...next])
  }

  const content = (
    <Command>
      <CommandList>
        <CommandGroup>
          <CommandItem value="__all__" keywords={["Все"]} onSelect={() => onChange(value === null || selectedSet.size === options.length ? [] : null)}>
            <Check className={cn("mr-2 h-4 w-4 shrink-0", value === null || selectedSet.size === options.length ? "opacity-100" : "opacity-0")} />
            Все
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          {options.map(option => (
            <CommandItem
              key={option.id}
              value={option.id}
              keywords={[option.name]}
              onSelect={() => toggle(option.id)}
            >
              <Check className={cn("mr-2 h-4 w-4 shrink-0", selectedSet.has(option.id) ? "opacity-100" : "opacity-0")} />
              {option.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )

  const trigger = (
    <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
      <span className="truncate">{triggerLabel}</span>
      <ChevronsUpDown className="opacity-50 shrink-0 ml-2 h-4 w-4" />
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="p-4">{content}</DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" side="bottom" align="start" avoidCollisions={false}>
        {content}
      </PopoverContent>
    </Popover>
  )
}
