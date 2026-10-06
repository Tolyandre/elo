"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Base58ID } from "@/lib/id";
import { useRouter } from "next/navigation";
import { usePlayers } from "../players/PlayersContext";
import { useGames } from "../gamesContext";
import { useMatches } from "./MatchesContext";
import { useMe } from "../meContext";
import { useOffline } from "../offline/OfflineContext";
import { Match, updateMatchPromise } from "../api";
import { unchangedEditDateISO } from "./edit-date";
import { useCampSelection, type CampOverrides } from "@/hooks/useCampSelection";
import { useTournamentSlotFit } from "@/hooks/useTournamentSlotFit";
import { CampCheckboxes } from "@/components/camp-checkboxes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingRows } from "@/components/loading-rows";
import { LoginLink } from "@/components/login-link";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { ClubIcons } from "@/components/player-name";
import { GameCombobox } from "@/components/game-combobox";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { PendingMatch } from "@/lib/offline/types";
import { toDatetimeLocal } from "@/lib/datetime";
import {
    hasModeChoice,
    resolveMatchMode,
    type MatchMode,
} from "@/lib/game-modes";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type Participant = {
    id: Base58ID;
    name: string;
    points: string;
};

/** Login / permission alerts shown above the form on both the new and edit pages. */
export function MatchFormAuthAlerts() {
    const me = useMe();
    return (
        <>
            {!me.loading && !me.id && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle>Чтобы добавить партию, выполните вход</AlertTitle>
                    <AlertDescription>
                        <LoginLink />
                    </AlertDescription>
                </Alert>
            )}
            {!me.loading && me.id && !me.canEdit && (
                <Alert>
                    <AlertCircleIcon />
                    <AlertTitle><b>{me.name}</b> пока не можете добавлять партии</AlertTitle>
                    <AlertDescription>
                        <p>Кто-то должен разрешить вам доступ</p>
                    </AlertDescription>
                </Alert>
            )}
        </>
    );
}

export function MatchForm({ editPending, editSaved }: { editPending?: PendingMatch; editSaved?: Match }) {
    const { players, playerDisplayName, loading } = usePlayers();
    const { games } = useGames();
    const { pendingPlayers, pendingGames, offline, isSyncing, submitMatch, updatePendingMatch } = useOffline();
    const isEdit = !!editPending || !!editSaved;
    // Block saving an offline (pending) edit while a sync is running — the sync
    // could remove/rewrite this very match mid-flight. Creating and editing saved
    // matches are unaffected.
    const syncBlocked = !!editPending && isSyncing;

    // The whole form draft is persisted per target (a brand-new match, an offline
    // pending match, or a saved match), so a refresh keeps in-progress edits and
    // the three targets never share state.
    const draftKey = editPending?.clientId ?? (editSaved ? `saved:${editSaved.id}` : "new");
    const [participants, setParticipants] = useSessionStorage<Participant[]>(`match-form:${draftKey}:participants`, []);
    const [selectedGameId, setSelectedGameId] = useSessionStorage<Base58ID | undefined>(`match-form:${draftKey}:game`, undefined as Base58ID | undefined);
    const [editDate, setEditDate] = useSessionStorage<string>(`match-form:${draftKey}:date`, "");
    // Full-precision instant the saved/pending match already has. The date
    // control carries minute precision, so an untouched date must resubmit this
    // original instead of its truncated draft (edit-date.ts).
    const [originalDateISO, setOriginalDateISO] = useSessionStorage<string>(`match-form:${draftKey}:original-date`, "");
    // Persisted so the one-time prefill from the edited match survives a refresh
    // instead of clobbering the user's draft.
    const [seeded, setSeeded] = useSessionStorage<boolean>(`match-form:${draftKey}:seeded`, false);
    // Explicit camp-checkbox toggles keyed by camp id (ADR-27): they win over
    // the base set (the match's camps on edit, the participation rule on create).
    const [campOverrides, setCampOverrides] = useSessionStorage<CampOverrides>(`match-form:${draftKey}:camp-overrides`, {});
    // The match's current camps on edit — the pre-checked base set, seeded
    // once from the edited match. Links are editable (ADR-27, revised).
    const [campBaseIds, setCampBaseIds] = useSessionStorage<Base58ID[]>(`match-form:${draftKey}:camp-base`, []);
    // The tournament checkbox (ADR-26): default checked on create; on edit it
    // starts from the match's current link state and stays editable — uncheck
    // sends skip_tournament_link: true (detach), check sends false (attach to
    // the fitting playing slot); the server always re-verifies.
    const [tournamentChecked, setTournamentChecked] = useSessionStorage<boolean>(`match-form:${draftKey}:tournament-checked`, true);
    // Coop mode state (ADR-33): the chosen mode for a mixed game, the shared
    // game score and the win/loss flag. Only the coop path uses the score; the
    // result starts unselected — the player must pick it.
    const [modeChoice, setModeChoice] = useSessionStorage<MatchMode>(`match-form:${draftKey}:mode`, "competitive");
    const [gameScore, setGameScore] = useSessionStorage<string>(`match-form:${draftKey}:game-score`, "");
    const [gameWon, setGameWon] = useSessionStorage<boolean | null>(`match-form:${draftKey}:game-won`, null);
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const [gameScoreError, setGameScoreError] = useState(false);
    const [gameWonError, setGameWonError] = useState(false);
    const [bottomErrorMessage, setBottomErrorMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const router = useRouter();

    const { invalidate: invalidateMatches } = useMatches();
    const { invalidate: invalidatePlayers } = usePlayers();

    // The selected game's mode decides what the form offers (ADR-33): a fixed
    // competitive or coop form, or the toggle for a mixed one. An offline
    // pending game is not in the server list yet — its creation-time mode
    // travels with the pending entry.
    const selectedGameMode = useMemo(() => {
        if (!selectedGameId) return undefined;
        const game = games.find((g) => g.id === selectedGameId);
        if (game) return game.game_mode;
        return pendingGames.find((g) => g.clientId === selectedGameId)?.meta?.gameMode;
    }, [games, pendingGames, selectedGameId]);
    // A mixed game lets the player choose; the stored choice is ignored (and
    // reset below) whenever the game offers no choice.
    const coopMode = resolveMatchMode(selectedGameMode, modeChoice) === "coop";

    // Switching to a game whose mode rules out the choice resets the toggle.
    // An unknown mode (the games list still loading after a refresh, an
    // offline-pending game without meta) must leave the stored draft alone —
    // otherwise a refresh would wipe the choice before the list arrives.
    useEffect(() => {
        if ((selectedGameMode === "competitive" || selectedGameMode === "coop") && modeChoice !== "competitive") {
            setModeChoice("competitive");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedGameMode]);

    const clearDraft = () => {
        sessionStorage.removeItem(`match-form:${draftKey}:participants`);
        sessionStorage.removeItem(`match-form:${draftKey}:game`);
        sessionStorage.removeItem(`match-form:${draftKey}:date`);
        sessionStorage.removeItem(`match-form:${draftKey}:original-date`);
        sessionStorage.removeItem(`match-form:${draftKey}:seeded`);
        sessionStorage.removeItem(`match-form:${draftKey}:camp-overrides`);
        sessionStorage.removeItem(`match-form:${draftKey}:camp-base`);
        sessionStorage.removeItem(`match-form:${draftKey}:tournament-checked`);
        sessionStorage.removeItem(`match-form:${draftKey}:mode`);
        sessionStorage.removeItem(`match-form:${draftKey}:game-score`);
        sessionStorage.removeItem(`match-form:${draftKey}:game-won`);
    };

    const resolvePlayerName = (id: string): string => {
        const pending = pendingPlayers.find((p) => p.clientId === id);
        if (pending) return `${pending.name} (офлайн)`;
        const found = players.find((pl) => pl.id === id);
        return found ? playerDisplayName(found) : "Unknown";
    };

    // Display name for a participant, resolved at render time from the current
    // players/pending context (with the stored snapshot as a last-resort
    // fallback). Render-time resolution matters because a freshly-created player
    // is added to the selection before the players re-fetch lands — resolving
    // from current context means the name self-heals once the fetch completes,
    // instead of staying stuck on the "Unknown" snapshot taken at selection.
    const participantName = (p: Participant): string => {
        const resolved = resolvePlayerName(p.id);
        return resolved === "Unknown" ? p.name : resolved;
    };

    // Prefill once from the match being edited (after players are known). `seeded`
    // is persisted, so on a later refresh the saved draft is used as-is.
    useEffect(() => {
        if (loading || !isEdit || seeded) return;
        if (editPending) {
            const coopIds = editPending.mode === "coop"
                ? (editPending.playerIds ?? Object.keys(editPending.score))
                : Object.keys(editPending.score);
            setParticipants(
                coopIds.map((pid) => ({
                    id: pid as Base58ID,
                    points: String(editPending.score[pid] ?? 0),
                    name: resolvePlayerName(pid),
                })),
            );
            setSelectedGameId(editPending.gameId);
            setEditDate(toDatetimeLocal(new Date(editPending.createdAt)));
            setOriginalDateISO(new Date(editPending.createdAt).toISOString());
            setTournamentChecked(!(editPending.skipTournamentLink ?? false));
            if (editPending.mode === "coop") {
                setModeChoice("coop");
                setGameScore(editPending.gameScore != null ? String(editPending.gameScore) : "");
                setGameWon(editPending.gameWon ?? null);
            }
        } else if (editSaved) {
            setParticipants(
                Object.entries(editSaved.score).map(([pid, data]) => ({
                    id: pid as Base58ID,
                    points: String(data.score),
                    name: resolvePlayerName(pid),
                })),
            );
            setSelectedGameId(editSaved.game_id);
            setEditDate(editSaved.date ? toDatetimeLocal(editSaved.date) : "");
            // Prefer the raw server string (µs precision); the Date fallback
            // truncates to milliseconds.
            setOriginalDateISO(editSaved.dateISO ?? (editSaved.date ? editSaved.date.toISOString() : ""));
            setTournamentChecked(editSaved.tournament != null);
            if (editSaved.mode === "coop") {
                setModeChoice("coop");
                setGameScore(editSaved.game_score != null ? String(editSaved.game_score) : "");
                setGameWon(editSaved.game_won ?? null);
            }
        }
        setSeeded(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editPending, editSaved, loading, isEdit, seeded]);

    // Camps shown on the match date (now for a new match, the edited date
    // otherwise) — their checkboxes appear/disappear as the date changes (ADR-27).
    const relevantDate = useMemo(
        () => (isEdit && editDate ? new Date(editDate) : new Date()),
        [isEdit, editDate],
    );
    const playerIds = useMemo(() => participants.map((p) => p.id), [participants]);
    const selectedCampSet = useMemo(
        () => (isEdit ? campBaseIds : undefined),
        [isEdit, campBaseIds],
    );
    const {
        active: activeCampsForDate,
        checked: checkedCampIds,
        toggle: toggleCamp,
        idsToSubmit: campIdsToSubmit,
    } = useCampSelection(playerIds, relevantDate, {
        selectedIds: selectedCampSet,
        overrides: campOverrides,
        setOverrides: setCampOverrides,
    });

    // Tournament slot fit (ADR-26): whether the current roster+game exactly
    // match a playing slot of a running tournament — the checkbox offer.
    const slotFit = useTournamentSlotFit(playerIds, selectedGameId);
    // On a saved-edit the checkbox is also offered for a linked match (to
    // uncheck it); otherwise it needs a fitting slot. A pending (queued)
    // match keeps its checkbox: the association is not decided until sync.
    const tournamentVisible = editPending
        ? true
        : editSaved
            ? editSaved.tournament != null || slotFit.fits
            : slotFit.fits;
    const tournamentNames = editSaved?.tournament
        ? [editSaved.tournament.name]
        : slotFit.tournamentNames;

    // Seed the base set once from the edited match: the checkboxes start
    // pre-checked with the match's camps and stay editable (ADR-27, revised).
    useEffect(() => {
        if (isEdit === false || seeded === false || campBaseIds.length > 0) return;
        if (editPending) {
            setCampBaseIds(editPending.campArenaIds ?? []);
        } else if (editSaved) {
            setCampBaseIds(editSaved.camps.map((c) => c.id));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit, seeded, editPending, editSaved]);

    const handlePlayersChange = (newIds: Base58ID[]) => {
        setParticipants(
            newIds.map((id) => {
                const existing = participants.find((p) => p.id === id);
                return existing ?? { id, points: "", name: resolvePlayerName(id) };
            })
        );
    };

    const handlePointsChange = (id: string, value: string) => {
        setParticipants(
            participants.map((p) =>
                p.id === id ? { ...p, points: value } : p
            )
        );

        setErrors((prev) => ({ ...prev, [id]: !isNumber(value) }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!selectedGameId) return;
        if (participants.length === 0) return;
        // Проверка ошибок
        if (Object.values(errors).some(Boolean)) return;
        if (coopMode && !isNumber(gameScore)) {
            setGameScoreError(true);
            return;
        }
        if (coopMode && gameWon === null) {
            setGameWonError(true);
            return;
        }
        if (isEdit && !editDate) {
            setBottomErrorMessage("Укажите дату партии");
            return;
        }

        const score: Record<string, number> = {};
        participants.forEach(p => {
            score[p.id] = Number(p.points);
        });

        // Coop payload pieces (ADR-33): participants without per-player scores,
        // the shared game result; camps and the bracket never apply to a coop
        // match. The saved-edit sends an explicit empty camp set — converting a
        // camp-linked match requires detaching it in the same edit. Validation
        // above guarantees gameScore/gameWon are set on this path.
        const coopFields = coopMode
            ? {
                  mode: "coop" as const,
                  player_ids: participants.map((p) => p.id),
                  game_score: Number(gameScore),
                  game_won: gameWon === true,
              }
            : {};

        setSubmitting(true);
        try {
            if (editSaved) {
                await updateMatchPromise(editSaved.id, {
                    game_id: selectedGameId,
                    // Untouched date → original full-precision instant (edit-date.ts).
                    date: unchangedEditDateISO(editDate, originalDateISO) ?? new Date(editDate).toISOString(),
                    ...(coopMode
                        ? { ...coopFields, camp_arena_ids: [] as Base58ID[] }
                        : {
                              score,
                              // The desired camp set (ADR-27, revised): the server diffs
                              // it against the stored links (attach/detach, audited).
                              camp_arena_ids: campIdsToSubmit(),
                              // The desired tournament-link state (ADR-26): omitted when
                              // the checkbox is not offered at all.
                              ...(tournamentVisible ? { skip_tournament_link: !tournamentChecked } : {}),
                          }),
                });
                clearDraft();
                invalidateMatches();
                invalidatePlayers();
                toast.success("Партия обновлена");
                router.push(`/matches/view?id=${editSaved.id}`);
                return;
            }
            if (editPending) {
                updatePendingMatch(editPending.clientId, {
                    gameId: selectedGameId,
                    score: coopMode ? {} : score,
                    createdAt: unchangedEditDateISO(editDate, originalDateISO) ?? new Date(editDate).toISOString(),
                    ...(coopMode
                        ? {
                              campArenaIds: [],
                              skipTournamentLink: true,
                              mode: "coop" as const,
                              playerIds: participants.map((p) => p.id),
                              gameScore: Number(gameScore),
                              gameWon: gameWon === true,
                          }
                        : { campArenaIds: campIdsToSubmit(), skipTournamentLink: !tournamentChecked }),
                });
                clearDraft();
                router.push(`/matches/view?id=${encodeURIComponent(editPending.clientId)}`);
                return;
            }

            await submitMatch({
                game_id: selectedGameId,
                score: coopMode ? {} : score,
                ...(coopMode
                    ? { camp_arena_ids: [] as Base58ID[], ...coopFields }
                    : {
                          camp_arena_ids: campIdsToSubmit(),
                          // The explicit opt-out only when asked for; without it the
                          // server links the match at the write when it fits (ADR-26).
                          ...(tournamentVisible ? { skip_tournament_link: !tournamentChecked } : {}),
                      }),
            });
            setSuccess(true);
            clearDraft();
            // The match is queued under its final id; the sync (triggered right
            // away while online) invalidates the lists once it lands. The global
            // arena's match timeline shows the pending card, then the saved one
            // with the ratings.
            router.push(`/?tab=feed`);
        } catch (err) {
            setSuccess(false);
            if (err instanceof Error) {
                setBottomErrorMessage(err.message);
            } else {
                setBottomErrorMessage(String(err));
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (loading && !offline) return <LoadingRows />;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {offline && (editSaved ? (
                <Alert variant="destructive">
                    <CloudOff />
                    <AlertTitle>Нет связи с сервером — редактирование сохранённой партии недоступно</AlertTitle>
                    <AlertDescription>
                        Попробуйте снова, когда соединение восстановится.
                    </AlertDescription>
                </Alert>
            ) : (
                <Alert>
                    <CloudOff />
                    <AlertTitle>Офлайн — партия будет сохранена на устройстве</AlertTitle>
                    <AlertDescription>
                        Партия автоматически отправится на сервер, когда связь
                        восстановится.
                    </AlertDescription>
                </Alert>
            ))}
            {isEdit && (
                <div>
                    <label className="block font-semibold mb-2" htmlFor="matchDate">
                        Дата и время:
                    </label>
                    <Input
                        id="matchDate"
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        required
                    />
                </div>
            )}
            <div>
                <label className="block font-semibold mb-2" htmlFor="gameName">
                    Название игры:
                </label>
                <GameCombobox value={selectedGameId} onChange={setSelectedGameId} />
            </div>
            {hasModeChoice(selectedGameMode) && (
                <div className="flex items-center justify-between">
                    <Label htmlFor="match-mode">Соло или кооператив</Label>
                    <Switch
                        id="match-mode"
                        checked={coopMode}
                        onCheckedChange={(v) => setModeChoice(v ? "coop" : "competitive")}
                    />
                </div>
            )}
            {!coopMode && (
                <>
                    <CampCheckboxes
                        active={activeCampsForDate}
                        checked={checkedCampIds}
                        onToggle={toggleCamp}
                    />
                    {tournamentVisible && (
                        <div>
                            <h2 className="font-semibold mb-2">Турнир:</h2>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <Input
                                    type="checkbox"
                                    className="h-4 w-4 p-0"
                                    checked={tournamentChecked}
                                    onChange={(e) => setTournamentChecked(e.target.checked)}
                                />
                                <span>
                                    {tournamentNames.length > 0
                                        ? `Засчитать в турнир: ${tournamentNames.join(", ")}`
                                        : "Засчитать в турнир (если подходит под стол)"}
                                </span>
                            </label>
                        </div>
                    )}
                </>
            )}
            <div>
                <h2 className="font-semibold mb-2">Участники:</h2>
                <PlayerMultiSelect value={participants.map(p => p.id)} onChange={handlePlayersChange} activeCampIds={coopMode ? [] : checkedCampIds} />

            </div>
            {participants.length > 0 && (coopMode ? (
                <div className="flex flex-col gap-2">
                    <h2 className="font-semibold mb-2">Игровой счёт:</h2>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="game-score" className="sr-only">Игровой счёт</Label>
                        <Input
                            id="game-score"
                            type="text"
                            inputMode="numeric"
                            value={gameScore}
                            onChange={(e) => {
                                setGameScore(e.target.value);
                                setGameScoreError(!isNumber(e.target.value));
                            }}
                            aria-invalid={gameScoreError || undefined}
                            className="w-24"
                            required
                        />
                        <span>очков</span>
                    </div>
                    {gameScoreError && (
                        <span className="text-destructive text-xs">Некорректный формат числа</span>
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setGameWon(true); setGameWonError(false); }}
                            aria-pressed={gameWon === true}
                            className={cn(
                                "w-28 rounded-md border px-3 py-1.5 text-sm text-center transition-colors",
                                gameWon === true
                                    ? "border-success bg-success text-primary-foreground"
                                    : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                            )}
                        >
                            Победа
                        </button>
                        <button
                            type="button"
                            onClick={() => { setGameWon(false); setGameWonError(false); }}
                            aria-pressed={gameWon === false}
                            className={cn(
                                "w-28 rounded-md border px-3 py-1.5 text-sm text-center transition-colors",
                                gameWon === false
                                    ? "border-destructive bg-destructive text-primary-foreground"
                                    : "border-border bg-transparent text-muted-foreground hover:bg-accent",
                            )}
                        >
                            Поражение
                        </button>
                    </div>
                    {gameWonError && (
                        <span className="text-destructive text-xs">Выберите: победа или поражение</span>
                    )}
                </div>
            ) : (
                <div>
                    <h2 className="font-semibold mb-2">Укажите очки для каждого:</h2>
                    <div className="grid grid-cols-1 gap-2">
                        {participants.map((p) => (
                            <div key={p.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-40 flex items-center gap-1 min-w-0">
                                        <ClubIcons playerId={p.id} />
                                        <span className="truncate">{participantName(p)}</span>
                                    </span>
                                    <Input
                                        type="text"
                                        inputMode="numeric"
                                        value={p.points}
                                        onChange={(e) =>
                                            handlePointsChange(p.id, e.target.value)
                                        }
                                        aria-invalid={errors[p.id] || undefined}
                                        className="w-20"
                                        required
                                    />
                                    <span>очков</span>
                                </div>
                                {errors[p.id] && (
                                    <span className="text-destructive text-xs">Некорректный формат числа</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            {bottomErrorMessage && (
                <div className="text-destructive text-sm">{bottomErrorMessage}</div>
            )}
            <Button
                type="submit"
                disabled={participants.length === 0 || !selectedGameId || submitting || syncBlocked}
                aria-busy={submitting}
            >
                {submitting ? (
                    <>
                        <svg className="animate-spin h-4 w-4 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                        </svg>
                        Сохранение...
                    </>
                ) : (
                    isEdit ? 'Сохранить изменения' : offline ? 'Сохранить офлайн' : 'Сохранить результат'
                )}
            </Button>
            {syncBlocked && (
                <div className="text-muted-foreground text-sm">Идёт синхронизация — подождите…</div>
            )}
            {success && (
                <div className="text-success font-semibold mt-2">
                    Партия добавлена! Перенаправление...
                </div>
            )}
        </form>
    );
}

function isNumber(value?: string | number): boolean {
    return ((value != null) &&
        (value !== '') &&
        !isNaN(Number(value.toString())));
}
