"use client"
import React, { useState } from "react";
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
import { GameCombobox } from "@/components/game-combobox";
import { PlayerMultiSelect } from "@/components/player-multi-select";
import { PlayerCombobox } from "@/components/player-combobox";

export default function NewMarketPage() {
    const me = useMe();
    const router = useRouter();

    const [marketType, setMarketType] = useState<"match_winner" | "win_streak">("match_winner");
    const [startsAtMode, setStartsAtMode] = useState<"now" | "specific">("now");
    const [startsAt, setStartsAt] = useState("");
    const [closesAt, setClosesAt] = useState("");
    // match_winner
    const [targetPlayerID, setTargetPlayerID] = useState("");
    const [requiredPlayerIDs, setRequiredPlayerIDs] = useState<string[]>([]);
    const [gameID, setGameID] = useState<string | undefined>(undefined);
    // win_streak
    const [streakTargetPlayerID, setStreakTargetPlayerID] = useState("");
    const [streakGameID, setStreakGameID] = useState<string | undefined>(undefined);
    const [winsRequired, setWinsRequired] = useState("3");
    const [maxLosses, setMaxLosses] = useState("");

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
                target_player_id: marketType === "match_winner" ? targetPlayerID : streakTargetPlayerID,
            };
            if (marketType === "match_winner") {
                payload.required_player_ids = requiredPlayerIDs;
                payload.game_id = gameID || null;
            } else {
                payload.streak_game_id = streakGameID || null;
                payload.wins_required = parseInt(winsRequired) || 0;
                payload.max_losses = maxLosses !== "" ? parseInt(maxLosses) : null;
            }
            await createMarketPromise(payload);
            router.push("/markets");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка");
        } finally {
            setSubmitting(false);
        }
    }

    function buildPreviewMarket(): Market {
        const targetID = marketType === "match_winner" ? targetPlayerID : streakTargetPlayerID;
        const params = marketType === "match_winner"
            ? { required_player_ids: requiredPlayerIDs, game_id: gameID ?? null }
            : { game_id: streakGameID ?? "", wins_required: parseInt(winsRequired) || 0, max_losses: maxLosses !== "" ? parseInt(maxLosses) : null };
        const startsAtISO = startsAtMode === "specific" && startsAt ? new Date(startsAt).toISOString() : new Date().toISOString();
        const closesAtISO = closesAt ? new Date(closesAt).toISOString() : null;
        return {
            id: "", market_type: marketType, status: "open",
            starts_at: startsAtISO, closes_at: closesAtISO,
            created_at: null, resolved_at: null,
            yes_pool: 0, no_pool: 0, yes_coefficient: 1, no_coefficient: 1,
            target_player_id: targetID, params,
        };
    }

    return (
        <main className="max-w-sm mx-auto space-y-6">
            <h1 className="text-2xl font-semibold">Создать рынок</h1>

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
                            <Label>Целевой игрок (должен победить)</Label>
                            <PlayerCombobox value={targetPlayerID || undefined} onChange={v => setTargetPlayerID(v ?? "")} allowClear />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Обязательные соперники</Label>
                            <PlayerMultiSelect value={requiredPlayerIDs} onChange={setRequiredPlayerIDs} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Игра (необязательно)</Label>
                            <GameCombobox value={gameID} onChange={setGameID} />
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
                            <Label>Игра</Label>
                            <GameCombobox value={streakGameID} onChange={setStreakGameID} />
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

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" disabled={submitting || !canEdit} className="w-full">
                    {submitting ? "Создание..." : "Создать"}
                </Button>
            </form>
        </main>
    );
}
