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

/** value = null means "all clubs" */
export function ClubSelect({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const { clubs } = useClubs()
  const { isMobile } = useIsMobile()
  const [open, setOpen] = React.useState(false)

  const options: ClubOption[] = React.useMemo(() => [
    ...[...clubs].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map(c => ({ id: c.id, name: c.name })),
    { id: NO_CLUB_ID, name: NO_CLUB_LABEL },
  ], [clubs])

  const triggerLabel = React.useMemo(() => {
    if (value === null) return "Клуб..."
    return options.find(o => o.id === value)?.name ?? "Клуб..."
  }, [value, options])

  function select(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  const content = (
    <Command>
      <CommandList>
        <CommandGroup>
          <CommandItem value="__all__" keywords={["Все"]} onSelect={() => select(null)}>
            <Check className={cn("mr-2 h-4 w-4 shrink-0", value === null ? "opacity-100" : "opacity-0")} />
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
              onSelect={() => select(option.id)}
            >
              <Check className={cn("mr-2 h-4 w-4 shrink-0", value === option.id ? "opacity-100" : "opacity-0")} />
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
