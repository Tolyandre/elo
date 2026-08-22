"use client"
import React, { useState } from "react";
import { PageHeader } from "@/app/pageHeaderContext";
import { useRouter } from "next/navigation";
import { Market, createMarketPromise } from "@/app/api";
import { useMe } from "@/app/meContext";
import { ResolutionDescription } from "@/components/resolution-description";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    "new-market/guarantorIDs",
    "new-market/liquidityB",
] as const;

export default function NewMarketPage() {
    const me = useMe();
    const router = useRouter();

    const [marketType, setMarketType] = useSessionStorage<"match_winner" | "win_streak">("new-market/marketType", "match_winner");
    const [startsAtMode, setStartsAtMode] = useSessionStorage<"now" | "specific">("new-market/startsAtMode", "now");
    const [startsAt, setStartsAt] = useSessionStorage("new-market/startsAt", "");
    const [closesAt, setClosesAt] = useSessionStorage("new-market/closesAt", "");
    // match_winner: one "player wins" outcome per target plus the "other"
    // outcome (ties / non-target winners).
    const [targetPlayerIDs, setTargetPlayerIDs] = useSessionStorage<string[]>("new-market/targetPlayerIDs", []);
    const [allowOtherPlayers, setAllowOtherPlayers] = useSessionStorage("new-market/allowOtherPlayers", true);
    const [gameIDs, setGameIDs] = useSessionStorage<string[]>("new-market/gameIDs", []);
    // win_streak
    const [streakTargetPlayerID, setStreakTargetPlayerID] = useSessionStorage("new-market/streakTargetPlayerID", "");
    const [streakGameIDs, setStreakGameIDs] = useSessionStorage<string[]>("new-market/streakGameIDs", []);
    const [winsRequired, setWinsRequired] = useSessionStorage("new-market/winsRequired", "3");
    const [maxLosses, setMaxLosses] = useSessionStorage("new-market/maxLosses", "");
    // Fixed-odds guarantors: prefilled with the creator's player. They split the
    // market's settlement residual (deficit or surplus) — see ADR-10.
    const [guarantorIDs, setGuarantorIDs] = useSessionStorage<string[]>(
        "new-market/guarantorIDs",
        me.playerId ? [me.playerId] : [],
    );
    // LMSR liquidity parameter (bounds guarantor worst-case loss at b·ln n for n
    // outcomes).
    const [liquidityB, setLiquidityB] = useSessionStorage("new-market/liquidityB", "16");

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const canEdit = me.canEdit;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const payload: Parameters<typeof createMarketPromise>[0] = {
                market_type: marketType,
                starts_at: startsAtMode === "now" ? null : new Date(startsAt).toISOString(),
                closes_at: new Date(closesAt).toISOString(),
            };
            if (marketType === "match_winner") {
                payload.target_player_ids = targetPlayerIDs;
                payload.allow_other_players = allowOtherPlayers;
                payload.game_ids = gameIDs;
            } else {
                payload.target_player_id = streakTargetPlayerID;
                payload.streak_game_ids = streakGameIDs;
                payload.wins_required = parseInt(winsRequired) || 0;
                payload.max_losses = maxLosses !== "" ? parseInt(maxLosses) : null;
            }
            payload.guarantor_player_ids = guarantorIDs;
            const lb = parseFloat(liquidityB);
            if (!isNaN(lb) && lb > 0) {
                payload.liquidity_b = lb;
            }
            await createMarketPromise(payload);
            STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k));
            router.push("/markets");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка");
        } finally {
            setSubmitting(false);
        }
    }

    function buildPreviewMarket(): Market {
        const startsAtISO = startsAtMode === "specific" && startsAt ? new Date(startsAt).toISOString() : new Date().toISOString();
        const closesAtISO = closesAt ? new Date(closesAt).toISOString() : null;
        if (marketType === "match_winner") {
            // Preview outcomes: one per target plus "other", uniform prices.
            const n = targetPlayerIDs.length + 1;
            const price = 1 / n;
            return {
                id: "", market_type: marketType, status: "open",
                starts_at: startsAtISO, closes_at: closesAtISO,
                created_at: null, resolved_at: null,
                liquidity_b: parseFloat(liquidityB) || 16,
                outcomes: [
                    ...targetPlayerIDs.map((id) => ({
                        id: `preview:${id}`, kind: "player" as const, player_id: id, name: "",
                        price, shares: 0, pool: 0,
                    })),
                    { id: "preview:other", kind: "other" as const, player_id: null, name: "Ничья", price, shares: 0, pool: 0 },
                ],
                params: { target_player_ids: targetPlayerIDs, allow_other_players: allowOtherPlayers, game_ids: gameIDs },
            };
        }
        return {
            id: "", market_type: marketType, status: "open",
            starts_at: startsAtISO, closes_at: closesAtISO,
            created_at: null, resolved_at: null,
            liquidity_b: parseFloat(liquidityB) || 16,
            outcomes: [
                { id: "preview:yes", kind: "yes" as const, player_id: null, name: "Да", price: 0.5, shares: 0, pool: 0 },
                { id: "preview:no", kind: "no" as const, player_id: null, name: "Нет", price: 0.5, shares: 0, pool: 0 },
            ],
            params: {
                target_player_id: streakTargetPlayerID, game_ids: streakGameIDs,
                wins_required: parseInt(winsRequired) || 0,
                max_losses: maxLosses !== "" ? parseInt(maxLosses) : null,
            },
        };
    }

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <PageHeader title="Создать рынок" />

            {!canEdit && (
                <Alert>
                    <AlertCircleIcon className="h-4 w-4" />
                    <AlertTitle>Только администратор может создавать события</AlertTitle>
                    <AlertDescription />
                </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                        <input
                            type="datetime-local"
                            className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                            value={startsAt}
                            onChange={e => setStartsAt(e.target.value)}
                            required
                        />
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="closes_at">Закрытие</Label>
                    <input
                        id="closes_at"
                        type="datetime-local"
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        value={closesAt}
                        onChange={e => setClosesAt(e.target.value)}
                        required
                    />
                </div>

                {marketType === "match_winner" && (
                    <>
                        <div className="space-y-1.5">
                            <Label>Участники партии</Label>
                            <PlayerMultiSelect value={targetPlayerIDs} onChange={setTargetPlayerIDs} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 font-normal cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="size-4 rounded border-input"
                                    checked={allowOtherPlayers}
                                    onChange={e => setAllowOtherPlayers(e.target.checked)}
                                />
                                Разрешить других игроков
                            </label>
                            <p className="text-xs text-muted-foreground">
                                {allowOtherPlayers
                                    ? "Ничья и победа другого игрока разрешаются исходом «Ничья»."
                                    : "Ничья разрешаются исходом «Ничья»."}
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Игры (необязательно)</Label>
                            <GameMultiSelect value={gameIDs} onChange={setGameIDs} />
                        </div>
                    </>
                )}

                {marketType === "win_streak" && (
                    <>
                        <div className="space-y-1.5">
                            <Label>Целевой игрок</Label>
                            <PlayerCombobox value={streakTargetPlayerID || undefined} onChange={v => setStreakTargetPlayerID(v ?? "")} allowClear />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Игры</Label>
                            <GameMultiSelect value={streakGameIDs} onChange={setStreakGameIDs} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="wins_required">Побед требуется</Label>
                            <input
                                id="wins_required"
                                type="number"
                                min={1}
                                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                value={winsRequired}
                                onChange={e => setWinsRequired(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="max_losses">Макс. поражений (необязательно)</Label>
                            <input
                                id="max_losses"
                                type="number"
                                min={0}
                                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                value={maxLosses}
                                onChange={e => setMaxLosses(e.target.value)}
                                placeholder="без ограничений"
                            />
                        </div>
                    </>
                )}

                <ResolutionDescription market={buildPreviewMarket()} />

                <div className="space-y-1.5">
                    <Label>Поручители (покрывают остаток рейтинга)</Label>
                    <PlayerMultiSelect value={guarantorIDs} onChange={setGuarantorIDs} />
                    <p className="text-xs text-muted-foreground">
                        Поручители — контрагенты рынка: они делят между собой дефицит или излишек рейтинга при разрешении.
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="liquidity_b">Ликвидность (b)</Label>
                    <input
                        id="liquidity_b"
                        type="number"
                        min={0.001}
                        step="any"
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        value={liquidityB}
                        onChange={e => setLiquidityB(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Параметр маркет-мейкера: больше b — менее резкое изменение цен и больше максимальный убыток поручителей (b·ln n, где n — количество исходов рынка).
                    </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" disabled={submitting || !canEdit} className="w-full">
                    {submitting ? "Создание..." : "Создать"}
                </Button>
            </form>
        </main>
    );
}
