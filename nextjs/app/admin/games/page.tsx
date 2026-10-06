"use client"
import type { Base58ID } from "@/lib/id";
import React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Dices, Pencil, Plus, Trash2 } from "lucide-react";
import { SiBoardgamegeek } from "@icons-pack/react-simple-icons";
import { PageHeader } from "@/app/pageHeaderContext";
import { useState } from "react";
import {
    deleteGamePromise,
    addGameTagPromise,
    removeGameTagPromise,
    autoMatchGamesPromise,
    enrichGameImagesPromise,
    Tag,
    GameListItem,
} from "@/app/api";
import { LoginLink } from "@/components/login-link";
import { useGames } from "@/app/gamesContext";
import { useTags } from "@/app/tagsContext";
import { useMe } from "@/app/meContext";
import { useOffline } from "@/app/offline/OfflineContext";
import { PendingEntityList } from "@/components/pending-entity-list";
import { ConfirmDialog, useConfirmAction } from "@/components/confirm-dialog";
import { AdminPageTabs } from "@/components/admin/admin-page-tabs";
import { GameEditDialog } from "@/components/admin/game-edit-dialog";
import { TagManagement } from "@/components/admin/tag-management";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { EmptyState } from "@/components/empty-state";
import { GameImage } from "@/components/game-image";
import { ResponsiveTable } from "@/components/responsive-table";
import { BackButton } from "@/components/back-button";
import { cn } from "@/lib/utils";
import { accentName, bggUrl, matchesAnyName, secondaryNames, teseraUrl } from "@/lib/game-names";

type GameRow = GameListItem;

export default function GamesAdminPage() {
    const { games: gamesFromContext, invalidate: invalidateGames } = useGames();
    const { isAuthenticated, canEdit, loading: meLoading } = useMe();
    const { pendingGames, offline, updatePendingGame, deletePendingGame } = useOffline();
    const [search, setSearch] = useState<string>("");
    const [filterTagIds, setFilterTagIds] = useState<Set<Base58ID>>(new Set());
    const [tab, setTab] = useState("main");
    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<GameRow | null>(null);
    const [matching, setMatching] = useState(false);
    const [enriching, setEnriching] = useState(false);

    const del = useConfirmAction(async (g: GameRow) => {
        await deleteGamePromise(g.id);
        invalidateGames();
    });

    // Sort games alphabetically for admin view
    const sortedGames = [...gamesFromContext].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Filter games by any of their names and/or by tag selection: selected
    // tags are OR-ed (a game matches when it carries any of them), then
    // AND-ed with the name filter.
    const query = search.trim().toLowerCase();
    const games = sortedGames.filter(g =>
        (query === "" || matchesAnyName(g, query)) &&
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
                <PageHeader
                    title="Управление играми"
                    action={tab === "main" && (
                        <Button onClick={() => setCreateOpen(true)} disabled={!canEdit}>
                            <Plus className="size-4" />
                            {offline ? "Добавить офлайн" : "Добавить"}
                        </Button>
                    )}
                />
                <BackButton href="/admin" />

            <AdminPageTabs entityType={["game", "tag"]} mainLabel="Игры" extraTab={{ label: "Теги", content: <TagManagement /> }} value={tab} onValueChange={setTab}>
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

            <Input
                className="mb-4"
                placeholder="Поиск по названию"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

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
                    {(search.trim() !== "" || filterTagIds.size > 0) && (
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
                                        {/* Icon actions keep the title wide on phones (the
                                            text buttons used to squeeze it to ~100px). */}
                                        <div className="flex gap-1 ml-2 shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => setEditTarget(game)}
                                                disabled={!canEdit}
                                                aria-label="Изменить игру"
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => del.trigger(game)}
                                                disabled={!canEdit}
                                                aria-label="Удалить игру"
                                            >
                                                <Trash2 className="size-4" />
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
            {/* Create dialog: the same metadata editor, queued through the offline store. */}
            {createOpen && (
                <GameEditDialog
                    game={null}
                    onClose={() => setCreateOpen(false)}
                    onSaved={() => {
                        setCreateOpen(false);
                        invalidateGames();
                    }}
                />
            )}
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
