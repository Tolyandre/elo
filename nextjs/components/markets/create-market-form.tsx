"use client"
import type { Base58ID } from "@/lib/id";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Market, createMarketPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { useTenantScope, useTenantMembership } from "@/app/tenantScopeContext";
import { participantsMembershipIssue } from "@/lib/tenant-members";
import { ResolutionDescription } from "@/components/resolution-description";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { isRatingGame } from "@/lib/game-modes";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AlertCircleIcon } from "lucide-react";
import { GameMultiSelect } from "@/components/game-multi-select";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { PlayerCombobox } from "@/components/player-combobox";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { matchWinnerFormIssue } from "./validation";


const STORAGE_KEYS = [
    "new-market/marketType",
    "new-market/startsAtMode",
    "new-market/startsAt",
    "new-market/closesAt",
    "new-market/targetPlayerIDs",
    "new-market/allowOtherPlayers",
    "new-market/gameIDs",
    "new-market/streakTargetPlayerID",
    "new-market/streakGameIDs",
    "new-market/winsRequired",
    "new-market/maxLosses",
] as const;

/**
 * The market creation form, the «Рынок» tab of the /new hub page. The hub
 * supplies the page container and the header; on success the app lands on the
 * main page's feed, where the new market enters at its creation moment.
 * Tournament_winner markets are absent by design — one is born automatically
 * when its tournament starts (ADR-35).
 */
export function CreateMarketForm() {
    const me = useMe();
    const router = useRouter();

    const [marketType, setMarketType] = useSessionStorage<"match_winner" | "win_streak">("new-market/marketType", "match_winner");
    const [startsAtMode, setStartsAtMode] = useSessionStorage<"now" | "specific">("new-market/startsAtMode", "now");
    const [startsAt, setStartsAt] = useSessionStorage("new-market/startsAt", "");
    const [closesAt, setClosesAt] = useSessionStorage("new-market/closesAt", "");
    // match_winner: one "player wins" outcome per target plus the "other"
    // outcome (ties / non-target winners).
    const [targetPlayerIDs, setTargetPlayerIDs] = useSessionStorage<Base58ID[]>("new-market/targetPlayerIDs", [] as Base58ID[]);
    const [allowOtherPlayers, setAllowOtherPlayers] = useSessionStorage("new-market/allowOtherPlayers", true);
    const [gameIDs, setGameIDs] = useSessionStorage<Base58ID[]>("new-market/gameIDs", [] as Base58ID[]);
    // win_streak
    const [streakTargetPlayerID, setStreakTargetPlayerID] = useSessionStorage<Base58ID | "">("new-market/streakTargetPlayerID", "" as Base58ID | "");
    const [streakGameIDs, setStreakGameIDs] = useSessionStorage<Base58ID[]>("new-market/streakGameIDs", [] as Base58ID[]);
    const [winsRequired, setWinsRequired] = useSessionStorage("new-market/winsRequired", "3");
    const [maxLosses, setMaxLosses] = useSessionStorage("new-market/maxLosses", "");

    const formIssue = marketType === "match_winner"
        ? matchWinnerFormIssue(targetPlayerIDs.length, allowOtherPlayers)
        : null;
    // No message for an empty selection — an untouched form stays quiet; the
    // disabled submit does the talking.
    const needsPlayers = marketType === "match_winner" && targetPlayerIDs.length === 0;

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const canEdit = me.canEdit;

    // The owning tenant (ADR-36) comes from the URL — the /new hub only renders
    // the form under a resolved tenant. Settlements land in its main arena; a
    // members_only tenant restricts bets to its members, so its markets may
    // only target members (otherwise the outcomes would be unbetable-by-rule).
    const { tenant } = useTenantScope();
    const tenantId = tenant?.id ?? "";
    const membersOnly = tenant?.arena_membership_mode === "members_only";
    // Membership degrades open when the club list is unavailable (offline,
    // nothing cached): the server validates the market at sync time instead.
    const { memberIds, known: membershipKnown } = useTenantMembership();
    // The membership check on the exact target set (a stale draft can hold a
    // non-member even with the picker restricted).
    const conditionIds = marketType === "match_winner"
        ? targetPlayerIDs
        : streakTargetPlayerID
            ? [streakTargetPlayerID]
            : [];
    const membershipIssue = tenant && membersOnly && membershipKnown
        ? participantsMembershipIssue(conditionIds, memberIds, "members_only", tenant.name)
        : null;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!tenant) {
            setError("Укажите сообщество");
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            const payload: Parameters<typeof createMarketPromise>[1] = {
                market_type: marketType,
                starts_at: startsAtMode === "now" ? null : new Date(startsAt).toISOString(),
            };
            if (marketType === "match_winner") {
                payload.closes_at = new Date(closesAt).toISOString();
                payload.target_player_ids = targetPlayerIDs;
                payload.allow_other_players = allowOtherPlayers;
                payload.game_ids = gameIDs;
            } else {
                payload.closes_at = new Date(closesAt).toISOString();
                payload.target_player_id = streakTargetPlayerID || undefined;
                payload.streak_game_ids = streakGameIDs;
                payload.wins_required = parseInt(winsRequired) || 0;
                payload.max_losses = maxLosses !== "" ? parseInt(maxLosses) : null;
            }
            await createMarketPromise(tenant.id, payload);
            STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k));
            router.push(`/?tenant=${tenant.id}&tab=feed`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка");
        } finally {
            setSubmitting(false);
        }
    }

    function buildPreviewMarket(): Market {
        const startsAtISO = startsAtMode === "specific" && startsAt ? new Date(startsAt).toISOString() : new Date().toISOString();
        const closesAtISO = closesAt ? new Date(closesAt).toISOString() : null;
        // The preview shows the market as it will be created (ADR-20): no
        // guarantors yet, so no liquidity — probabilities are the uniform
        // opening state.
        if (marketType === "match_winner") {
            // Preview outcomes: one per target plus "other", uniform probabilities.
            const n = targetPlayerIDs.length + 1;
            const probability = 1 / n;
            return {
                id: "" as Base58ID, market_type: marketType, status: "open",
                tenant_id: (tenantId || "") as Base58ID,
                starts_at: startsAtISO, closes_at: closesAtISO,
                created_at: null, resolved_at: null,
                liquidity_b: 0,
                outcomes: [
                    ...targetPlayerIDs.map((id) => ({
                        id: `preview:${id}` as Base58ID, kind: "player" as const, player_id: id, name: "",
                        probability, shares: 0, pool: 0,
                    })),
                    { id: "preview:other" as Base58ID, kind: "other" as const, player_id: null, name: "Ничья", probability, shares: 0, pool: 0 },
                ],
                params: { target_player_ids: targetPlayerIDs, allow_other_players: allowOtherPlayers, game_ids: gameIDs },
            };
        }
        return {
            id: "" as Base58ID, market_type: marketType, status: "open",
            tenant_id: (tenantId || "") as Base58ID,
            starts_at: startsAtISO, closes_at: closesAtISO,
            created_at: null, resolved_at: null,
            liquidity_b: 0,
            outcomes: [
                { id: "preview:yes" as Base58ID, kind: "yes" as const, player_id: null, name: "Да", probability: 0.5, shares: 0, pool: 0 },
                { id: "preview:no" as Base58ID, kind: "no" as const, player_id: null, name: "Нет", probability: 0.5, shares: 0, pool: 0 },
            ],
            params: {
                target_player_id: streakTargetPlayerID || ("" as Base58ID), game_ids: streakGameIDs,
                wins_required: parseInt(winsRequired) || 0,
                max_losses: maxLosses !== "" ? parseInt(maxLosses) : null,
            },
        };
    }

    return (
        <>
            {!canEdit && (
                <Alert>
                    <AlertCircleIcon className="h-4 w-4" />
                    <AlertTitle>Только администратор может создавать события</AlertTitle>
                    <AlertDescription />
                </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                        Сообщество: <span className="font-medium text-foreground">{tenant?.name ?? "—"}</span>
                    </p>
                    {membersOnly && (
                        <p className="text-xs text-muted-foreground">
                            Рынок принимает ставки только от участников сообщества — назначить можно тоже только их.
                        </p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label>Тип рынка</Label>
                    <Select value={marketType} onValueChange={(v) => setMarketType(v as typeof marketType)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="match_winner">Победитель партии</SelectItem>
                            <SelectItem value="win_streak">Серия побед</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label>Начало</Label>
                    <RadioGroup
                        value={startsAtMode}
                        onValueChange={(v) => setStartsAtMode(v as typeof startsAtMode)}
                        className="gap-2"
                    >
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="now" id="starts-now" />
                            <Label htmlFor="starts-now" className="font-normal cursor-pointer">Сразу</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="specific" id="starts-specific" />
                            <Label htmlFor="starts-specific" className="font-normal cursor-pointer">С определённой даты</Label>
                        </div>
                    </RadioGroup>
                    {startsAtMode === "specific" && (
                        <Input
                            type="datetime-local"
                            className="mt-1"
                            value={startsAt}
                            onChange={e => setStartsAt(e.target.value)}
                            required
                        />
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="closes_at">Закрытие</Label>
                    <Input
                        id="closes_at"
                        type="datetime-local"
                        value={closesAt}
                        onChange={e => setClosesAt(e.target.value)}
                        required
                    />
                </div>

                {marketType === "match_winner" && (
                    <>
                        <div className="space-y-1.5">
                            <Label>Участники партии</Label>
                            <PlayerMultiSelect
                                value={targetPlayerIDs}
                                onChange={setTargetPlayerIDs}
                                allowedPlayerIds={membersOnly && membershipKnown ? [...memberIds] : undefined}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 font-normal cursor-pointer">
                                <Checkbox
                                    checked={allowOtherPlayers}
                                    onCheckedChange={(v) => setAllowOtherPlayers(v === true)}
                                />
                                Разрешить других игроков
                            </label>
                            <p className="text-xs text-muted-foreground">
                                {allowOtherPlayers
                                    ? "Ничья и победа другого игрока разрешаются исходом «Ничья»."
                                    : "Ничья разрешаются исходом «Ничья»."}
                            </p>
                            {formIssue && <p className="text-xs text-destructive">{formIssue}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label>Игры (необязательно)</Label>
                            <GameMultiSelect value={gameIDs} onChange={setGameIDs} filter={isRatingGame} />
                        </div>
                    </>
                )}

                {marketType === "win_streak" && (
                    <>
                        <div className="space-y-1.5">
                            <Label>Целевой игрок</Label>
                            <PlayerCombobox
                                value={streakTargetPlayerID || undefined}
                                onChange={v => setStreakTargetPlayerID((v ?? "") as Base58ID | "")}
                                allowClear
                                allowedPlayerIds={membersOnly && membershipKnown ? [...memberIds] : undefined}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Игры (необязательно)</Label>
                            <GameMultiSelect value={streakGameIDs} onChange={setStreakGameIDs} filter={isRatingGame} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="wins_required">Побед требуется</Label>
                            <Input
                                id="wins_required"
                                type="number"
                                min={1}
                                value={winsRequired}
                                onChange={e => setWinsRequired(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            {/* max_losses is the defeat count that resolves «Нет»:
                                the Nth defeat ends the streak race. */}
                            <Label htmlFor="max_losses">Поражений до «Нет» (необязательно)</Label>
                            <Input
                                id="max_losses"
                                type="number"
                                min={1}
                                value={maxLosses}
                                onChange={e => setMaxLosses(e.target.value)}
                                placeholder="без ограничений"
                            />
                        </div>
                    </>
                )}

                <ResolutionDescription market={buildPreviewMarket()} />

                <p className="text-xs text-muted-foreground">
                    Ставки откроются с появлением первого поручителя: их суммарный риск
                    задаёт ликвидность рынка — чем глубже обеспечение, тем плавнее
                    двигаются цены.
                </p>

                {membershipIssue && <p className="text-xs text-destructive">{membershipIssue}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" disabled={submitting || !canEdit || formIssue !== null || membershipIssue !== null || needsPlayers} className="w-full">
                    {submitting ? "Создание..." : "Создать"}
                </Button>
            </form>
        </>
    );
}
