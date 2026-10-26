"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

import type { Base58ID } from "@/lib/id"
import { cn } from "@/lib/utils"
import { allNames, secondaryNames } from "@/lib/game-names"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { ResponsiveCommandPopover } from "@/components/responsive-command-popover"
import { GameImage } from "@/components/game-image"
import { GameCreateDialog } from "@/components/game-create-dialog"
import {
  useGames } from "@/app/gamesContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { useFavoriteGames } from "@/app/useFavoriteGames"
import useIsMobile from "@/hooks/use-is-mobile"
import { buildGameGroups, buildGameTabs, type GameGroup, type GameTab } from "@/lib/game-groups"
import type { GameListItem } from "@/app/api"

type GameOption = { value: string; label: string; game?: GameListItem }

export function GameCombobox({
  value: controlledValue,
  onChange,
  filterGame,
}: {
  value?: Base58ID
  onChange?: (id?: Base58ID) => void
  /** Optional game filter — e.g. hiding coop-only games from the tournament pool picker (ADR-33). */
  filterGame?: (game: GameListItem) => boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)

  const value = controlledValue !== undefined ? controlledValue : internalValue

  const { games } = useGames();
  const { matches } = useMatches();
  const { playerId } = useMe();
  const { isMobile } = useIsMobile();
  const { pendingGames } = useOffline();
  const favorites = useFavoriteGames();

  const visibleGames = React.useMemo(
    () => (filterGame ? games.filter(filterGame) : games),
    [games, filterGame],
  );

  // Browse view: the «Избранные» / «Остальные» tabs.
  const tabs = React.useMemo(
    () => buildGameTabs(visibleGames, matches, playerId, favorites),
    [visibleGames, matches, playerId, favorites],
  );

  // Search view: the flat Недавние / Популярные / Остальные sections; cmdk
  // hides the groups whose games don't match.
  const searchGroups = React.useMemo(
    () => buildGameGroups(visibleGames, matches, playerId, favorites),
    [visibleGames, matches, playerId, favorites],
  );

  const offlineGroup = React.useMemo((): GameGroup | undefined => {
    if (pendingGames.length === 0) return undefined;
    // A pending coop game is equally unusable in a rating picker (ADR-33).
    const visiblePending = filterGame
      ? pendingGames.filter((g) => g.meta?.gameMode !== "coop")
      : pendingGames;
    if (visiblePending.length === 0) return undefined;
    return {
      heading: "Офлайн (не сохранено)",
      options: visiblePending.map((g) => ({ value: g.clientId, label: `${g.name} (офлайн)`, game: undefined })),
    };
  }, [pendingGames, filterGame]);

  const displayName = (id: string) =>
    games.find((game) => game.id === id)?.name
    ?? pendingGames.find((g) => g.clientId === id)?.name;

  const handleSelect = (currentValue: string) => {
    const next = currentValue === value ? "" : currentValue;
    if (controlledValue === undefined) {
      setInternalValue(next);
    }
    onChange?.(next === "" ? undefined : (next as Base58ID));
    setOpen(false);
  };

  const selectCreated = (id: Base58ID) => {
    // Wait a bit for context to update
    setTimeout(() => {
      if (controlledValue === undefined) {
        setInternalValue(id);
      }
      if (onChange) {
        onChange(id);
      }
      setOpen(false);
    }, 100);
  };

  const handleCreateGame = () => {
    if (!searchQuery.trim()) return;
    // Confirm step: the dialog lets the user check the name and pick tags (the
    // way clubs are picked for a new player) before the game is queued.
    setOpen(false);
    setCreateOpen(true);
  };

  const handleCreated = (id: Base58ID) => {
    setSearchQuery("");
    selectCreated(id);
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-full justify-between"
    >
      {value ? (
        <span className="min-w-0 truncate">{displayName(value)}</span>
      ) : (
        "Игра..."
      )}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  )

  const mobileListClass = isMobile ? "flex-1 min-h-0 overflow-y-auto max-h-none" : undefined

  const content = (
    <GameCommand
      value={value}
      tabs={tabs}
      searchGroups={searchGroups}
      offlineGroup={offlineGroup}
      search={searchQuery}
      onSearchChange={setSearchQuery}
      onSelect={handleSelect}
      onCreate={handleCreateGame}
      listClassName={mobileListClass}
    />
  )

  return (
    <>
      <ResponsiveCommandPopover
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        content={content}
      />
      <GameCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={searchQuery.trim()}
        onCreated={handleCreated}
      />
    </>
  )
}

type GameCommandProps = {
  value: string
  tabs: GameTab[]
  searchGroups: GameGroup[]
  offlineGroup?: GameGroup
  search: string
  onSearchChange: (search: string) => void
  onSelect: (value: string) => void
  onCreate: () => void
  listClassName?: string
}

function GameCommand({ value, tabs, searchGroups, offlineGroup, search, onSearchChange, onSelect, onCreate, listClassName }: GameCommandProps) {
  const [activeTab, setActiveTab] = React.useState<string | undefined>(tabs[0]?.key)

  const activeKey = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]?.key
  const current = tabs.find((t) => t.key === activeKey)
  const searching = search.trim().length > 0

  // The offline pending games ride on top of both views (cmdk filters and
  // hides the group itself while searching).
  const sections = React.useMemo(() => {
    const base = searching ? searchGroups : current?.sections ?? []
    return offlineGroup ? [offlineGroup, ...base] : base
  }, [searching, searchGroups, current, offlineGroup])

  const renderItem = (option: GameOption, keyPrefix: string) => (
    <CommandItem
      key={`${keyPrefix}-${option.value}`}
      value={option.value}
      keywords={option.game ? allNames(option.game) : [option.label]}
      onSelect={onSelect}
    >
      {option.game?.image_thumb_url && (
        <GameImage src={option.game.image_thumb_url} alt="" className="size-7 shrink-0 rounded-sm" />
      )}
      <div className="min-w-0 flex-1">
        {/* Inline flow: the secondary names start on the same
            line as the accent name and whatever does not fit
            wraps to the next line at full width. The accent name
            is plain inline text with nowrap (never inline-block:
            overflow-hidden boxes align by their bottom edge and
            break the shared baseline). */}
        <span className="mr-2 whitespace-nowrap">{option.label}</span>
        {option.game && (
          <span className="text-xs text-muted-foreground">
            {secondaryNames(option.game).join(" · ")}
          </span>
        )}
      </div>
      <Check
        className={cn(
          "ml-auto shrink-0",
          value === option.value ? "opacity-100" : "opacity-0"
        )}
      />
    </CommandItem>
  )

  return (
    <Command shouldFilter={true} className={listClassName ? "flex flex-col flex-1 min-h-0" : undefined}>
      <CommandInput
        placeholder="Искать игру..."
        className="h-9"
        value={search}
        onValueChange={onSearchChange}
      />

      {!searching && tabs.length > 1 && (
        <Tabs value={activeKey} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full h-auto flex-wrap justify-start gap-1 px-1">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="flex-none shrink-0 gap-1 whitespace-nowrap">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <CommandList className={listClassName}>
        <CommandEmpty>
          <div className="py-2 px-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-sm"
              onClick={onCreate}
              disabled={!search.trim()}
            >
              <Plus className="mr-2 h-4 w-4" />
              {`Создать "${search}"`}
            </Button>
          </div>
        </CommandEmpty>
        {sections.map((section, i) => (
          <React.Fragment key={section.heading || `s${i}`}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={section.heading || undefined}>
              {section.options.map((game) => renderItem(game, `${searching ? "search" : activeKey}-${i}`))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </Command>
  )
}
