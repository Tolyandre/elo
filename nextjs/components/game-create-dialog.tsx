"use client"

import * as React from "react"

import type { Base58ID } from "@/lib/id"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  AcceptedGameSuggestion,
  AcceptedMetaLine,
  GameSuggestionChips,
  suggestionMeta,
  useGameSuggestions,
} from "@/components/game-suggestions"
import { useTags } from "@/app/tagsContext"
import { useMe } from "@/app/meContext"
import { useOffline } from "@/app/offline/OfflineContext"
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from "@/lib/game-modes"

/**
 * Confirm-create dialog for a brand-new game picked from a picker's search:
 * name (pre-filled from the search, editable) plus toggleable tag chips — the
 * same flow as creating a player with clubs in the player picker.
 *
 * Creates always queue via the offline store (the pending game's clientId is
 * its final server id); the sync engine attaches the chosen tags right after
 * the create lands.
 */
export function GameCreateDialog({
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
            Проверьте название, выберите режим и при необходимости теги.
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
  const [gameMode, setGameMode] = React.useState<GameMode>("competitive")
  const [creating, setCreating] = React.useState(false)
  const [accepted, setAccepted] = React.useState<AcceptedGameSuggestion | null>(null)

  // Catalogue suggestions for the typed name; best-effort — a network failure
  // or offline state simply leaves the list empty and creation continues.
  const suggestions = useGameSuggestions(name, true)

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
      const game = addPendingGame(trimmed, [...selectedTagIds], {
        nameEn: accepted?.nameEn,
        nameRu: accepted?.nameRu,
        bggRef: accepted?.bggRef,
        teseraRef: accepted?.teseraRef,
        gameMode,
      })
      onClose()
      onCreated(game.clientId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Input
        placeholder="Название игры"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmCreate(); } }}
        autoFocus
        aria-label="Название новой игры"
      />
      <div className="space-y-1.5">
        <Label htmlFor="new-game-mode">Режим игры</Label>
        <Select value={gameMode} onValueChange={(v) => setGameMode(v as GameMode)}>
          <SelectTrigger id="new-game-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GAME_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {GAME_MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <GameSuggestionChips
        suggestions={suggestions.suggestions}
        accepted={accepted}
        onAccept={(s) => setAccepted(suggestionMeta(s))}
        onClear={() => setAccepted(null)}
        loading={suggestions.loading}
        failed={suggestions.failed}
        teseraUnavailable={suggestions.teseraUnavailable}
        bggUnavailable={suggestions.bggUnavailable}
      />
      {accepted && <AcceptedMetaLine accepted={accepted} />}
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
