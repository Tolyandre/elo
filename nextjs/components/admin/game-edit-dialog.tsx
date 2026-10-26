"use client"
import { useState } from "react";
import { toast } from "sonner";
import { SiBoardgamegeek } from "@icons-pack/react-simple-icons";
import {
    patchGamePromise,
    refreshGameArtPromise,
    type GameListItem,
    type GameMetadata,
    type GameSuggestion,
} from "@/app/api";
import { useOffline } from "@/app/offline/OfflineContext";
import { useGames } from "@/app/gamesContext";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from "@/lib/game-modes";
import { accentName, findDuplicateGame } from "@/lib/game-names";
import {
    GameSuggestionChip,
    GameSuggestionsStatus,
    suggestionKey,
    useGameSuggestions,
} from "@/components/game-suggestions";
import { GameImage } from "@/components/game-image";

type GameRow = GameListItem;

/**
 * Game metadata editor doubling as the create form. `game = null` creates a
 * new game: the same fields as the editor, queued through the offline store
 * (addPendingGame — the queued name is the display fallback alias → ru → en,
 * and AddGame re-derives the alias server-side when it differs from the
 * canonical names), so creation works offline exactly like the old inline
 * form did. With a game, the full metadata state is PATCHed. Both modes share
 * the alias, canonical names, BGG/Tesera ids, game mode, and a catalogue
 * picker (BGG first, Tesera second) that fills the canonical fields from a
 * picked candidate — never the alias. Editing also carries the box-art row: a
 * preview plus an explicit refresh that overwrites stored art (the automatic
 * enrichment only fills empty images). The server recomputes the display name
 * (alias/name → ru → English) and rejects a save that leaves no name at all.
 */
export function GameEditDialog({
    game,
    onClose,
    onSaved,
}: {
    game: GameRow | null; // null = create a new game
    onClose: () => void;
    onSaved: () => void;
}) {
    const { addPendingGame, pendingGames } = useOffline();
    const { games, invalidate: invalidateGames } = useGames();
    const [alias, setAlias] = useState(game?.alias ?? "");
    const [nameEn, setNameEn] = useState(game?.name_en ?? "");
    const [nameRu, setNameRu] = useState(game?.name_ru ?? "");
    const [bggRef, setBggRef] = useState(game?.bgg_ref != null ? String(game.bgg_ref) : "");
    const [teseraRef, setTeseraRef] = useState(game?.tesera_ref != null ? String(game.tesera_ref) : "");
    const [gameMode, setGameMode] = useState<GameMode>(game?.game_mode ?? "competitive");
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [art, setArt] = useState<{ imageUrl: string | null; thumbUrl: string | null }>({
        imageUrl: game?.image_url ?? null,
        thumbUrl: game?.image_thumb_url ?? null,
    });
    const [pickerQuery, setPickerQuery] = useState("");

    const { suggestions, loading: searching, failed: searchFailed, teseraUnavailable, bggUnavailable } = useGameSuggestions(pickerQuery, pickerQuery.trim().length >= 2);

    const preview = [alias.trim(), nameRu.trim(), nameEn.trim()].find((n) => n !== "") ?? "";
    // Create mode only: the queued name becomes the server display name, so a
    // game already claiming it — server list or offline queue — would fail at
    // sync with the unique-name error. Edits rely on the server's PATCH rejection.
    const duplicate = game ? undefined : findDuplicateGame([...games, ...pendingGames], preview);
    const canSave = preview !== "" && duplicate == null;

    /** The full-state metadata payload both save and the art refresh persist. */
    function metadata(): GameMetadata {
        return {
            alias: alias.trim() || null,
            name_en: nameEn.trim() || null,
            name_ru: nameRu.trim() || null,
            bgg_ref: bggRef.trim() ? Number.parseInt(bggRef, 10) : null,
            tesera_ref: teseraRef.trim() ? Number.parseInt(teseraRef, 10) : null,
            game_mode: gameMode,
        };
    }

    async function save() {
        if (!canSave) return;
        if (!game) {
            const meta = metadata();
            // Creates always queue (the clientId is the final server id); the
            // sync flushes it within a round trip while online. The queue's
            // name is the display fallback (alias → ru → en): AddGame turns it
            // into an alias server-side when it differs from the canonical
            // names, and keeps it as the only canonical name otherwise.
            addPendingGame(preview, [], {
                nameEn: meta.name_en ?? null,
                nameRu: meta.name_ru ?? null,
                bggRef: meta.bgg_ref ?? null,
                teseraRef: meta.tesera_ref ?? null,
                gameMode,
            });
            onSaved();
            return;
        }
        setSaving(true);
        try {
            await patchGamePromise(game.id, metadata());
            onSaved();
        } catch {
            // toast shown by API helper
        } finally {
            setSaving(false);
        }
    }

    /**
     * Save-then-refresh, dialog stays open: persist the current fields (the
     * possibly just-typed BGG id is what the refresh fetches by), then
     * re-fetch the box art, overwriting whatever is stored — the remedy for
     * wrong or stale art that the automatic enrichment (empty-images-only)
     * deliberately leaves alone.
     */
    async function refreshArt() {
        if (!game || refreshing || !canSave || !bggRef.trim()) return;
        setRefreshing(true);
        try {
            await patchGamePromise(game.id, metadata());
            const res = await refreshGameArtPromise(game.id);
            if (res.refreshed) {
                setArt({ imageUrl: res.image_url ?? null, thumbUrl: res.image_thumb_url ?? null });
                toast.success("Обложка обновлена");
            } else if (res.reason === "no image on BGG") {
                toast.info("У этой игры на BoardGameGeek нет обложки");
            } else {
                toast.error("Игра с таким id не найдена на BoardGameGeek — проверьте id");
            }
            invalidateGames();
        } catch {
            // toast shown by API helper
        } finally {
            setRefreshing(false);
        }
    }

    /**
     * Accepting a candidate fills the canonical names and links only — the
     * alias stays the user's own convenient name (empty means "display under
     * the canonical name").
     */
    function accept(s: GameSuggestion) {
        setNameEn(s.name_en ?? "");
        setNameRu(s.name_ru ?? "");
        setBggRef(s.bgg_ref != null ? String(s.bgg_ref) : "");
        setTeseraRef(s.tesera_ref != null ? String(s.tesera_ref) : "");
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {game ? <>Изменить игру «{accentName(game)}»</> : "Новая игра"}
                    </DialogTitle>
                    <DialogDescription>
                        Отображаемое название: псевдоним, иначе русское, иначе английское.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                        Псевдоним (удобное название на русском)
                        <div className="flex gap-2">
                            <Input
                                value={alias}
                                onChange={(e) => setAlias(e.target.value)}
                                placeholder="например, Бутылочка"
                            />
                            {game?.alias && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAlias("")}
                                    title="Убрать псевдоним — игра будет отображаться под каноническим названием"
                                >
                                    Убрать
                                </Button>
                            )}
                        </div>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        Название на английском (если игра издавалась официально)
                        <Input
                            value={nameEn}
                            onChange={(e) => setNameEn(e.target.value)}
                            placeholder="например, The Bottle Imp"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        Русское название (если игра издавалась официально)
                        <Input
                            value={nameRu}
                            onChange={(e) => setNameRu(e.target.value)}
                            placeholder="например, Тень в бутылке"
                        />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-sm">
                            BGG id
                            <Input
                                inputMode="numeric"
                                value={bggRef}
                                onChange={(e) => setBggRef(e.target.value.replace(/[^\d]/g, ""))}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            Tesera id
                            <Input
                                inputMode="numeric"
                                value={teseraRef}
                                onChange={(e) => setTeseraRef(e.target.value.replace(/[^\d]/g, ""))}
                            />
                        </label>
                    </div>
                    {game && (
                        <div className="flex items-center gap-3">
                            {art.thumbUrl ? (
                                <GameImage src={art.thumbUrl} alt="" className="size-10 shrink-0 rounded" />
                            ) : (
                                <div className="size-10 shrink-0 rounded bg-muted" aria-hidden />
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={refreshArt}
                                disabled={!canSave || refreshing || !bggRef.trim()}
                                aria-busy={refreshing}
                            >
                                {refreshing ? <Spinner className="size-4" /> : <SiBoardgamegeek className="size-4" />}
                                Обновить обложку
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                Обложка берётся из BGG.
                            </span>
                        </div>
                    )}
                    <div className="flex flex-col gap-1 text-sm">
                        <Label htmlFor="game-mode">Режим игры</Label>
                        <Select value={gameMode} onValueChange={(v) => setGameMode(v as GameMode)}>
                            <SelectTrigger id="game-mode" className="w-full">
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
                        <p className="text-xs text-muted-foreground">
                            {gameMode === "coop"
                                ? "Кооперативные и сольные партии не влияют на рейтинг, арены, рынки и турниры."
                                : gameMode === "mixed"
                                    ? "Режим выбирается при записи каждой партии."
                                    : "Обычные партии с очками за каждого игрока."}
                        </p>
                    </div>
                    {preview && (
                        <p className="text-xs text-muted-foreground">
                            Отображается как: <span className="font-medium text-foreground">{preview}</span>
                        </p>
                    )}
                    {duplicate && (
                        <p className="text-destructive text-sm" role="alert">
                            Игра «{accentName(duplicate)}» уже существует
                        </p>
                    )}

                    <div className="border-t pt-3 flex flex-col gap-2">
                        <p className="text-sm font-medium">Подобрать в каталогах BGG и Tesera</p>
                        <Input
                            placeholder="Название для поиска"
                            value={pickerQuery}
                            onChange={(e) => setPickerQuery(e.target.value)}
                        />
                        <GameSuggestionsStatus
                            loading={searching}
                            failed={searchFailed}
                            teseraUnavailable={teseraUnavailable}
                            bggUnavailable={bggUnavailable}
                        />
                        {pickerQuery.trim().length >= 2 && !searching && !searchFailed && suggestions.length === 0 && !teseraUnavailable && !bggUnavailable && (
                            <p className="text-xs text-muted-foreground">Ничего не найдено</p>
                        )}
                        <div className="flex flex-wrap gap-1">
                            {suggestions.map((s) => (
                                <GameSuggestionChip
                                    key={suggestionKey(s)}
                                    suggestion={s}
                                    onPick={(picked) => {
                                        accept(picked);
                                        setPickerQuery("");
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Отмена
                    </Button>
                    <Button onClick={save} disabled={saving || !canSave} aria-busy={saving}>
                        {saving && <Spinner className="size-4" />}
                        {game ? "Сохранить" : "Добавить"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
