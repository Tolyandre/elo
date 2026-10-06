"use client"
import type { Base58ID } from "@/lib/id";
import React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Dices } from "lucide-react";
import { SiBoardgamegeek } from "@icons-pack/react-simple-icons";
import { PageHeader } from "@/app/pageHeaderContext";
import { useState } from "react";
import {
    patchGamePromise,
    deleteGamePromise,
    addGameTagPromise,
    removeGameTagPromise,
    autoMatchGamesPromise,
    enrichGameImagesPromise,
    Tag,
    GameListItem,
    GameSuggestion,
} from "@/app/api";
import { LoginLink } from "@/components/login-link";
import { useGames } from "@/app/gamesContext";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { TagManagement } from "@/components/admin/tag-management";
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
import { PageContainer } from "@/components/page-container";
import { EmptyState } from "@/components/empty-state";
import { GameImage } from "@/components/game-image";
import { ResponsiveTable } from "@/components/responsive-table";
import { BackButton } from "@/components/back-button";
import { cn } from "@/lib/utils";
import { accentName, bggUrl, matchesAnyName, secondaryNames, teseraUrl } from "@/lib/game-names";
import {
    GameSuggestionChips,
    suggestionLabel,
    suggestionMeta,
    useGameSuggestions,
} from "@/components/game-suggestions";

type GameRow = GameListItem;

export default function GamesAdminPage() {
    const { games: gamesFromContext, invalidate: invalidateGames } = useGames();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();
    const { pendingGames, offline, addPendingGame, updatePendingGame, deletePendingGame } = useOffline();
    const [newName, setNewName] = useState<string>("");
    const [newAccepted, setNewAccepted] = useState<ReturnType<typeof suggestionMeta> | null>(null);
    const [filterTagIds, setFilterTagIds] = useState<Set<Base58ID>>(new Set());
    const [editTarget, setEditTarget] = useState<GameRow | null>(null);
    const [matching, setMatching] = useState(false);
    const [enriching, setEnriching] = useState(false);

    const del = useConfirmAction(async (g: GameRow) => {
        await deleteGamePromise(g.id);
        invalidateGames();
    });

    // Сatalogue suggestions for the "add game" input; best-effort — a network
    // failure or offline state leaves the list empty and adding still works.
    const newSuggestions = useGameSuggestions(newName, true);

    // Sort games alphabetically for admin view
    const sortedGames = [...gamesFromContext].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Filter games by any of their names and/or by tag selection: selected
    // tags are OR-ed (a game matches when it carries any of them), then
    // AND-ed with the name filter.
    const search = newName.trim().toLowerCase();
    const games = sortedGames.filter(g =>
        (search === "" || matchesAnyName(g, search)) &&
        (filterTagIds.size === 0 || g.tags.some(t => filterTagIds.has(t.id)))
    );

    function toggleFilterTag(id: Base58ID) {
        setFilterTagIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function addGame() {
        if (!newName || newName.trim() === "") return;
        // Creates always queue (the clientId is the final server id); the
        // sync flushes it within a round trip while online.
        addPendingGame(newName.trim(), [], newAccepted ? {
            nameEn: newAccepted.nameEn,
            nameRu: newAccepted.nameRu,
            bggRef: newAccepted.bggRef,
            teseraRef: newAccepted.teseraRef,
        } : undefined);
        setNewName("");
        setNewAccepted(null);
    }

    /** Bulk exact-name matching against Tesera for games without a Tesera link. */
    async function runAutoMatch() {
        setMatching(true);
        try {
            const results = await autoMatchGamesPromise();
            const matched = results.filter((r) => r.matched).length;
            if (results.length === 0) {
                toast.success("Все игры уже сопоставлены");
            } else {
                toast.success(`Сопоставлено ${matched} из ${results.length}`);
            }
            invalidateGames();
        } catch {
            // toast shown by API helper
        } finally {
            setMatching(false);
        }
    }

    const unmatchedCount = gamesFromContext.filter((g) => !g.tesera_ref).length;
    // Games with a BGG link whose box art was not fetched yet (the enrich run
    // fills image URLs for exactly this set).
    const unenrichedCount = gamesFromContext.filter((g) => g.bgg_ref && !g.image_url && !g.image_thumb_url).length;

    /** BGG box-art backfill for games with a bgg_ref and no image yet. */
    async function runBggEnrich() {
        setEnriching(true);
        try {
            const results = await enrichGameImagesPromise();
            const enriched = results.filter((r) => r.enriched).length;
            if (results.length === 0) {
                toast.success("Все обложки уже загружены");
            } else {
                toast.success(`Загружено обложек: ${enriched} из ${results.length}`);
            }
            invalidateGames();
        } catch {
            // toast shown by API helper
        } finally {
            setEnriching(false);
        }
    }

    return (
        <PageContainer width="full">
                <PageHeader title="Управление играми" />
                <BackButton href="/admin" />

            <AdminPageTabs entityType={["game", "tag"]} mainLabel="Игры" extraTab={{ label: "Теги", content: <TagManagement /> }}>
            {!meLoading && !isAuthenticated && (
                <div className="flex flex-col items-start gap-2">
                    <p>Для редактирования необходимо авторизоваться.</p>
                    <LoginLink />
                </div>
            )}
            {!meLoading && isAuthenticated && !canEdit && <p>У вас нет прав для редактирования игр.</p>}
            <p>Удаление возможно для игр без партий. Нажмите на тег под игрой, чтобы присвоить или убрать его.</p>

            <section className="mb-4 mt-4 rounded border p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium">Сопоставление с каталогами</h3>
                    <p className="text-sm text-muted-foreground">
                        Автоматически проставить ссылки на BoardGameGeek и Тесеру, загрузить обложки из BGG.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <Button
                        onClick={runAutoMatch}
                        disabled={!canEdit || matching}
                    >
                        {matching && <Spinner className="size-4" />}
                        Подобрать ссылки{unmatchedCount > 0 ? ` (${unmatchedCount})` : ""}
                    </Button>
                    <Button
                        onClick={runBggEnrich}
                        disabled={!canEdit || enriching}
                        variant="outline"
                    >
                        {enriching ? <Spinner className="size-4" /> : <SiBoardgamegeek className="size-4" />}
                        Загрузить обложки{unenrichedCount > 0 ? ` (${unenrichedCount})` : ""}
                    </Button>
                </div>
            </section>

            <div className="mb-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <Input
                    className="flex-1"
                    placeholder="Название игры"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGame(); } }}
                />
                <div className="w-full sm:w-auto">
                    <Button
                        onClick={addGame}
                        disabled={!canEdit}
                    >
                        {offline ? "Добавить офлайн" : "Добавить"}
                    </Button>
                </div>
            </div>
            <div className="mb-4">
                <GameSuggestionChips
                    suggestions={newSuggestions}
                    accepted={newAccepted}
                    onAccept={(s) => setNewAccepted(suggestionMeta(s))}
                    onClear={() => setNewAccepted(null)}
                />
            </div>

            <TagFilterRow selected={filterTagIds} onToggle={toggleFilterTag} />

            <PendingEntityList
                title="Не сохранённые игры"
                items={pendingGames}
                canEdit={canEdit}
                onRename={updatePendingGame}
                onDelete={deletePendingGame}
            />

            <section className="mt-6">
                <h2 className="text-lg font-medium mb-3">
                    Список игр
                    {(newName.trim() !== "" || filterTagIds.size > 0) && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                            (найдено: {games.length} из {sortedGames.length})
                        </span>
                    )}
                </h2>
                {games.length === 0 ? (
                    <EmptyState title="Нет игр" />
                ) : (
                    <ResponsiveTable
                        mobile={
                            // Mobile list
                            <div className="space-y-2 mb-4">
                            {games.map((game) => (
                                <div key={game.id} className="border rounded p-3">
                                    <div className="flex justify-between items-start">
                                        <div className="min-w-0">
                                            <GameNames game={game} />
                                            <div className="text-sm text-muted-foreground">Партий: {game.total_matches}</div>
                                            <CatalogLinks game={game} />
                                        </div>
                                        <div className="flex gap-2 ml-4 shrink-0">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setEditTarget(game)}
                                                disabled={!canEdit}
                                            >
                                                Изменить
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => del.trigger(game)}
                                                disabled={!canEdit}
                                            >
                                                Удалить
                                            </Button>
                                        </div>
                                    </div>
                                    <GameTagChips game={game} />
                                </div>
                            ))}
                            </div>
                        }
                        desktop={
                            // Desktop / larger screens: table with horizontal scroll if needed
                            <div className="overflow-x-auto">
                            <table className="min-w-full table-auto border-collapse mb-6">
                                <thead>
                                    <tr>
                                        <th className="text-left px-4 py-2">Название</th>
                                        <th className="text-left px-4 py-2">Ссылки</th>
                                        <th className="text-left px-4 py-2">Партий</th>
                                        <th className="text-left px-4 py-2">Теги</th>
                                        <th className="text-left px-4 py-2">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {games.map((game) => (
                                        <tr key={game.id} className="align-top">
                                            <td className="px-4 py-2 max-w-72">
                                                <GameNames game={game} />
                                            </td>
                                            <td className="px-4 py-2">
                                                <CatalogLinks game={game} />
                                            </td>
                                            <td className="px-4 py-2">{game.total_matches}</td>
                                            <td className="px-4 py-2">
                                                <GameTagChips game={game} />
                                            </td>
                                            <td className="px-4 py-2">
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setEditTarget(game)}
                                                        disabled={!canEdit}
                                                    >
                                                        Изменить
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => del.trigger(game)}
                                                        disabled={!canEdit}
                                                    >
                                                        Удалить
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        }
                    />
                )}
            </section>
            </AdminPageTabs>
            {/* Metadata edit dialog */}
            {editTarget && (
                <GameEditDialog
                    game={editTarget}
                    onClose={() => setEditTarget(null)}
                    onSaved={() => {
                        setEditTarget(null);
                        invalidateGames();
                    }}
                />
            )}

            {/* Delete confirm dialog */}
            <ConfirmDialog
                open={del.open}
                onOpenChange={del.onOpenChange}
                title="Удалить игру"
                description={del.target ? <>Вы уверены, что хотите удалить игру «{del.target.name}»? Это действие нельзя отменить.</> : undefined}
                confirmText="Удалить"
                confirmVariant="destructive"
                loading={del.pending}
                onConfirm={del.confirm}
            />
        </PageContainer>
    );
}

/** Box art, accent name as a link, secondary names muted underneath. */
function GameNames({ game }: { game: GameRow }) {
    return (
        <div className="flex items-center gap-2 min-w-0">
            {game.image_thumb_url && (
                <GameImage src={game.image_thumb_url} alt="" className="size-8 shrink-0 rounded" />
            )}
            <div className="min-w-0">
                <Link className="underline font-medium" href={`/games/view?id=${game.id}`}>{accentName(game)}</Link>
                {secondaryNames(game).length > 0 && (
                    <div className="text-sm text-muted-foreground">{secondaryNames(game).join(" · ")}</div>
                )}
            </div>
        </div>
    );
}

/** Compact catalog links: BGG and Tesera, only when the ids are set. */
function CatalogLinks({ game }: { game: GameRow }) {
    if (!game.bgg_ref && !game.tesera_ref) return <span className="text-muted-foreground text-sm">—</span>;
    return (
        <div className="flex gap-1 items-center">
            {game.bgg_ref && (
                <a
                    href={bggUrl(game.bgg_ref)}
                    target="_blank"
                    rel="noreferrer"
                    title="BoardGameGeek"
                    className="inline-flex items-center justify-center size-7 rounded border hover:bg-accent"
                >
                    <SiBoardgamegeek className="size-4" />
                </a>
            )}
            {game.tesera_ref && (
                <a
                    href={teseraUrl(game.tesera_ref)}
                    target="_blank"
                    rel="noreferrer"
                    title="Тесера"
                    className="inline-flex items-center justify-center size-7 rounded border hover:bg-accent"
                >
                    <Dices className="size-4" />
                </a>
            )}
        </div>
    );
}

/**
 * Metadata editor: alias (removable), canonical names, BGG/Tesera ids, and a
 * catalogue picker that fills the canonical fields from Tesera. Saves the
 * full metadata state; the server recomputes the display name (alias →
 * ru → English) and rejects a save that leaves no name at all.
 */
function GameEditDialog({
    game,
    onClose,
    onSaved,
}: {
    game: GameRow;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [alias, setAlias] = useState(game.alias ?? "");
    const [nameEn, setNameEn] = useState(game.name_en ?? "");
    const [nameRu, setNameRu] = useState(game.name_ru ?? "");
    const [bggRef, setBggRef] = useState(game.bgg_ref != null ? String(game.bgg_ref) : "");
    const [teseraRef, setTeseraRef] = useState(game.tesera_ref != null ? String(game.tesera_ref) : "");
    const [saving, setSaving] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    const suggestions = useGameSuggestions(pickerQuery, pickerQuery.trim().length >= 2);

    const preview = [alias.trim(), nameRu.trim(), nameEn.trim()].find((n) => n !== "") ?? "";

    async function save() {
        if (!preview) return;
        const bgg = bggRef.trim() ? Number.parseInt(bggRef, 10) : null;
        const tesera = teseraRef.trim() ? Number.parseInt(teseraRef, 10) : null;
        setSaving(true);
        try {
            await patchGamePromise(game.id, {
                alias: alias.trim() || null,
                name_en: nameEn.trim() || null,
                name_ru: nameRu.trim() || null,
                bgg_ref: bgg,
                tesera_ref: tesera,
            });
            onSaved();
        } catch {
            // toast shown by API helper
        } finally {
            setSaving(false);
        }
    }

    /** Accepting a candidate fills the canonical names and links, keeping the alias. */
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
                    <DialogTitle>Изменить игру «{accentName(game)}»</DialogTitle>
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
                            {game.alias && (
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
                    {preview && (
                        <p className="text-xs text-muted-foreground">
                            Отображается как: <span className="font-medium text-foreground">{preview}</span>
                        </p>
                    )}

                    <div className="border-t pt-3 flex flex-col gap-2">
                        <p className="text-sm font-medium">Подобрать в каталоге Tesera</p>
                        <Input
                            placeholder="Название для поиска"
                            value={pickerQuery}
                            onChange={(e) => setPickerQuery(e.target.value)}
                        />
                        {pickerQuery.trim().length >= 2 && suggestions.length === 0 && (
                            <p className="text-xs text-muted-foreground">Ничего не найдено (или каталог недоступен).</p>
                        )}
                        <div className="flex flex-wrap gap-1">
                            {suggestions.map((s) => (
                                <button
                                    key={s.tesera_ref}
                                    type="button"
                                    onClick={() => {
                                        accept(s);
                                        setPickerQuery("");
                                    }}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent text-left",
                                        s.is_addition && "opacity-70",
                                    )}
                                >
                                    {suggestionLabel(s)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Отмена
                    </Button>
                    <Button onClick={save} disabled={saving || !preview} aria-busy={saving}>
                        {saving && <Spinner className="size-4" />}
                        Сохранить
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Tag vocabulary as filter chips under the search input: selected tags narrow
 * the game list to games carrying any of them. The chip count shows global
 * usage. A view control — available to everyone, no edit permission required.
 */
function TagFilterRow({ selected, onToggle }: { selected: Set<Base58ID>; onToggle: (id: Base58ID) => void }) {
    const { tags } = useTags();
    if (tags.length === 0) return null;
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return (
        <div className="flex flex-wrap gap-1 items-center mb-4">
            {sortedTags.map((tag) => {
                const active = selected.has(tag.id);
                return (
                    <button
                        key={tag.id}
                        type="button"
                        onClick={() => onToggle(tag.id)}
                        className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs transition-colors",
                            active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                        )}
                        aria-pressed={active}
                    >
                        {tag.name}
                        <span className="opacity-60">({tag.game_count})</span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * All tags of the vocabulary as toggle chips under one game: filled = attached,
 * outline = available. Clicking toggles the attachment immediately, so a game's
 * tags are switched without any dialog. Usage counts live on the filter chips.
 */
function GameTagChips({ game }: { game: GameRow }) {
    const { canEdit } = useMe();
    const { tags, invalidate: invalidateTags } = useTags();
    const { invalidate: invalidateGames } = useGames();
    const [busyIds, setBusyIds] = useState<Set<Base58ID>>(new Set());

    const attachedIds = new Set(game.tags.map((t) => t.id));
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    async function toggleTag(tag: Tag) {
        const attached = attachedIds.has(tag.id);
        setBusyIds((prev) => new Set(prev).add(tag.id));
        try {
            if (attached) {
                await removeGameTagPromise(game.id, tag.id);
            } else {
                await addGameTagPromise(game.id, tag.id);
            }
            // Refresh both lists: the games list carries the new attachment,
            // the tag list the changed usage counts.
            invalidateGames();
            invalidateTags();
        } catch {
            // toast shown by API helper
        } finally {
            setBusyIds((prev) => {
                const next = new Set(prev);
                next.delete(tag.id);
                return next;
            });
        }
    }

    return (
        <div className="flex flex-wrap gap-1 items-center mt-2">
            {sortedTags.map((tag) => {
                const attached = attachedIds.has(tag.id);
                const busy = busyIds.has(tag.id);
                return (
                    <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        disabled={!canEdit || busy}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                            attached
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                            (!canEdit || busy) && "opacity-50 cursor-not-allowed",
                        )}
                        aria-pressed={attached}
                    >
                        {tag.name}
                    </button>
                );
            })}
        </div>
    );
}
