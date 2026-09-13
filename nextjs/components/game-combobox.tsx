"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"

import type { Base58ID } from "@/lib/id"
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
import { ResponsiveCommandPopover } from "@/components/responsive-command-popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useGames } from "@/app/gamesContext"
import { useTags } from "@/app/tagsContext"
import { useMatches } from "@/app/matches/MatchesContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import useIsMobile from "@/hooks/use-is-mobile"
import { buildGameGroups } from "@/lib/game-groups"

export function GameCombobox({
  value: controlledValue,
  onChange,
}: {
  value?: Base58ID
  onChange?: (id?: Base58ID) => void
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

  const groups = React.useMemo(() => {
    const base = buildGameGroups(games, matches, playerId);
    if (pendingGames.length === 0) return base;
    return [
      {
        heading: "Офлайн (не сохранено)",
        options: pendingGames.map((g) => ({ value: g.clientId, label: `${g.name} (офлайн)` })),
      },
      ...base,
    ];
  }, [games, matches, playerId, pendingGames]);

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
      {value ? displayName(value) : "Игра..."}
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
              type="button"
              variant="ghost"
              className="w-full justify-start text-sm"
              onClick={handleCreateGame}
              disabled={!searchQuery.trim()}
            >
              <Plus className="mr-2 h-4 w-4" />
              {`Создать "${searchQuery}"`}
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

/**
 * Confirm-create dialog for a brand-new game picked from the search: name
 * (pre-filled from the search, editable) plus toggleable tag chips — the same
 * flow as creating a player with clubs in the player picker.
 *
 * Creates always queue via the offline store (the pending game's clientId is
 * its final server id); the sync engine attaches the chosen tags right after
 * the create lands.
 */
function GameCreateDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName: string
  onCreated: (id: Base58ID) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая игра</DialogTitle>
          <DialogDescription>
            Проверьте название и при необходимости выберите теги.
          </DialogDescription>
        </DialogHeader>
        {/* Inside the (unmounted-when-closed) dialog content, so the draft
            state re-seeds from the picker's search text on every open. */}
        <GameCreateForm
          initialName={initialName}
          onCreated={onCreated}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function GameCreateForm({
  initialName,
  onCreated,
  onClose,
}: {
  initialName: string
  onCreated: (id: Base58ID) => void
  onClose: () => void
}) {
  const { tags } = useTags()
  const { canEdit } = useMe()
  const { addPendingGame } = useOffline()

  const [name, setName] = React.useState(initialName)
  const [selectedTagIds, setSelectedTagIds] = React.useState<Set<Base58ID>>(new Set())
  const [creating, setCreating] = React.useState(false)

  const sortedTags = React.useMemo(
    () => [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [tags],
  )

  function toggleTag(tagId: Base58ID) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function confirmCreate() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const game = addPendingGame(trimmed, [...selectedTagIds])
      onClose()
      onCreated(game.clientId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <input
        className="w-full rounded border p-2"
        placeholder="Название игры"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmCreate(); } }}
        autoFocus
        aria-label="Название новой игры"
      />
      {sortedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          {sortedTags.map((tag) => {
            const selected = selectedTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                disabled={!canEdit}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                  !canEdit && "opacity-50 cursor-not-allowed",
                )}
                aria-pressed={selected}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={creating}>
          Отмена
        </Button>
        <Button onClick={confirmCreate} disabled={creating || !name.trim()} aria-busy={creating}>
          {creating && <Spinner className="size-4" />}
          Сохранить
        </Button>
      </DialogFooter>
    </>
  )
}
