"use client"

import { useMemo, useState } from "react"
import { MarketOutcome } from "@/app/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProbabilityChart, SettlementList } from "@/components/market-card"
import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { buyFee, sharesForTotal } from "@/app/markets/lmsr"
import { formatAmount } from "@/app/markets/format"
import { outcomeColors } from "@/app/markets/outcomeColors"
import { DEFAULT_MAX_GUARANTOR_LOSS } from "@/app/markets/new/liquidity"
import {
    PlaygroundResolution,
    PlaygroundState,
    PLAYGROUND_PLAYERS,
    awaitsGuarantors,
    currentFeeRate,
    initialPlaygroundState,
    joinAsGuarantor,
    liquidityB,
    playgroundOutcomeId,
    playgroundOutcomeName,
    placeBet,
    probabilities,
    resolveMarket,
    totalRisk,
} from "./playground/playground"

const QUICK_FEE_VALUES = [0, 1, 2, 5, 10, 15, 25];
const STAKES = [1, 2, 5];

function formatPercent(rate: number): string {
    const pct = (rate * 100).toFixed(1).replace(/\.0$/, "");
    return `${pct}%`;
}

// The buy-card clone of the market page's OutcomeColumn: the ×multiplier
// headline is what EVERY 1 of the stake brings (voices per 1 elo, shares
// divided by the stake), the caption is the whole buy's maker fee.
function PlaygroundOutcomeCard({
    label,
    color,
    probability,
    multiplier,
    fee,
    myStaked,
    myShares,
    stake,
    disabled,
    onBuy,
    isWinner,
}: {
    label: string;
    color?: string;
    probability: number;
    multiplier?: number;
    fee?: number;
    myStaked: number;
    myShares: number;
    stake: number;
    disabled: boolean;
    onBuy: () => void;
    isWinner: boolean;
}) {
    const headline = multiplier != null && Number.isFinite(multiplier)
        ? multiplier > 1000
            ? "×1000+"
            : `×${multiplier.toFixed(2)}`
        : probability.toFixed(2);
    return (
        <div className={`flex flex-col p-3 border rounded-lg gap-2 ${isWinner ? "border-green-500" : ""}`}>
            <div className="text-center min-w-0">
                <h4 className="font-semibold text-base truncate" style={{ color }} title={label}>
                    {isWinner ? "✓ " : ""}{label}
                </h4>
                <p className="text-xl font-bold leading-tight">{headline}</p>
                <p className="text-xs text-muted-foreground">вероятность {Math.round(probability * 100)}%</p>
            </div>
            <div className="text-xs space-y-0.5">
                {myShares > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Куплено голосов:</span>
                        <span>{formatAmount(myShares)}</span>
                    </div>
                )}
                {myStaked > 0 && (
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Поставлено:</span>
                        <span>{formatAmount(myStaked)}</span>
                    </div>
                )}
            </div>
            <Button
                size="sm"
                className="w-full mt-auto h-auto py-1.5"
                onClick={onBuy}
                disabled={disabled}
            >
                <span className="flex flex-col items-center leading-tight">
                    <span>Поставить {stake}</span>
                    {fee != null && fee >= 0.005 && (
                        <span className="text-[10px] font-normal opacity-80">
                            Поручители заработают {formatAmount(fee)}
                        </span>
                    )}
                </span>
            </Button>
        </div>
    );
}

/** One display row: a player's wagers with an identical fee squashed into total risk (as on the market page). */
function squashIdentical(guarantees: PlaygroundState["guarantees"]) {
    const rows = new Map<string, { key: string; playerId: string; name: string; risk: number; feeRate: number }>();
    for (const g of guarantees) {
        const key = `${g.playerId}:${g.feeRate}`;
        const row = rows.get(key) ?? {
            key,
            playerId: g.playerId,
            name: PLAYGROUND_PLAYERS.find((p) => p.id === g.playerId)?.name ?? g.playerId,
            risk: 0,
            feeRate: g.feeRate,
        };
        row.risk += g.riskAmount;
        rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.feeRate - a.feeRate || b.risk - a.risk);
}

/**
 * The interactive market of the help page: a fully local market with the real
 * math. The reader configures the outcome count and the guarantors' max loss,
 * then acts as different players — betting or backing the market — and
 * finally resolves it to see the real settlement.
 */
export function MarketPlayground() {
    const [state, setState] = useState<PlaygroundState>(() =>
        initialPlaygroundState({ outcomeCount: 3, maxGuarantorLoss: DEFAULT_MAX_GUARANTOR_LOSS }),
    );
    const [playerId, setPlayerId] = useState<string>(PLAYGROUND_PLAYERS[0].id);
    const [stake, setStake] = useState(1);
    const [risk, setRisk] = useState("4");
    const [feePercent, setFeePercent] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resolution, setResolution] = useState<PlaygroundResolution | null>(null);

    const b = liquidityB(state);
    const feeRate = currentFeeRate(state);
    const awaits = awaitsGuarantors(state);
    const probs = useMemo(() => probabilities(state), [state]);
    const frozen = resolution != null;

    function reset(outcomeCount = state.outcomeCount, maxGuarantorLoss = state.maxGuarantorLoss) {
        setState(initialPlaygroundState({ outcomeCount, maxGuarantorLoss }));
        setResolution(null);
        setError(null);
    }

    function handleBuy(index: number) {
        const next = placeBet(state, playerId, index, stake);
        if (next !== state) setState(next);
    }

    function handleJoin() {
        const riskAmount = parseFloat(risk.replace(",", "."));
        if (!(riskAmount > 0)) {
            setError("Укажите положительный размер риска");
            return;
        }
        if (feePercent == null) {
            setError("Выберите комиссию");
            return;
        }
        setError(null);
        setState(joinAsGuarantor(state, playerId, riskAmount, feePercent / 100));
        setFeePercent(null);
    }

    function handleResolve(index: number) {
        setResolution(resolveMarket(state, index));
    }

    // Synthetic MarketOutcome objects — the reused chart/settlement components
    // speak the market page's data shapes.
    const outcomes: MarketOutcome[] = useMemo(
        () => state.q.map((shares, i) => ({
            id: playgroundOutcomeId(i),
            kind: "player" as const,
            name: playgroundOutcomeName(i),
            probability: probs[i],
            shares,
            pool: state.bets.filter((bet) => bet.outcome === i).reduce((sum, bet) => sum + bet.cost, 0),
        })),
        [state, probs],
    );
    const colors = outcomeColors(outcomes);
    const nameOf = (o: MarketOutcome) => o.name;

    const playerName = PLAYGROUND_PLAYERS.find((p) => p.id === playerId)?.name ?? playerId;
    const myStakedByOutcome = new Map<number, number>();
    const mySharesByOutcome = new Map<number, number>();
    if (!frozen) {
        for (const bet of state.bets) {
            if (bet.playerId !== playerId) continue;
            myStakedByOutcome.set(bet.outcome, (myStakedByOutcome.get(bet.outcome) ?? 0) + bet.cost + bet.fee);
            mySharesByOutcome.set(bet.outcome, (mySharesByOutcome.get(bet.outcome) ?? 0) + bet.shares);
        }
    }

    return (
        <div className="space-y-4">
            {/* ── Конфигурация ── */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Настройка рынка</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Исходов: {state.outcomeCount}</Label>
                            <Slider
                                min={2} max={8} step={1}
                                value={[state.outcomeCount]}
                                onValueChange={([v]) => reset(v)}
                                disabled={frozen}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Максимальный риск поручителей L: {state.maxGuarantorLoss}</Label>
                            <Slider
                                min={2} max={64} step={1}
                                value={[state.maxGuarantorLoss]}
                                onValueChange={([v]) => reset(state.outcomeCount, v)}
                                disabled={frozen}
                            />
                            <p className="text-xs text-muted-foreground">
                                Настройка пересоздаёт рынок.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                            {awaits
                                ? "Ставки откроются, когда появится первый поручитель."
                                : <>Ликвидность b = {formatAmount(b)} · Комиссия рынка {formatPercent(feeRate)}</>}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => reset()}>
                            Сбросить
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* ── Игрок ── */}
            <div className="space-y-2">
                <Label>Действия от имени игрока</Label>
                <Tabs value={playerId} onValueChange={setPlayerId}>
                    <TabsList className="flex w-full flex-wrap h-auto">
                        {PLAYGROUND_PLAYERS.map((p) => (
                            <TabsTrigger key={p.id} value={p.id} className="text-xs">{p.name}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {awaits && (
                <Alert variant="warning">
                    <TriangleAlertIcon />
                    <AlertTitle>Рынок ждёт поручителей</AlertTitle>
                    <AlertDescription>
                        Как и на настоящем рынке: без поручителей ликвидность b = 0, и ставки невозможны.
                    </AlertDescription>
                </Alert>
            )}

            {/* ── Карточки ставок ── */}
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Label>Размер ставки</Label>
                    <div className="flex gap-1">
                        {STAKES.map((s) => (
                            <Button
                                key={s}
                                size="sm"
                                variant={stake === s ? "default" : "outline"}
                                className="h-7 px-3 text-xs"
                                onClick={() => setStake(s)}
                                disabled={frozen}
                            >
                                {s}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {outcomes.map((o, i) => {
                        const shares = awaits ? NaN : sharesForTotal(state.q, b, i, stake, feeRate);
                        const fee = awaits ? 0 : buyFee(state.q, b, i, shares, feeRate);
                        return (
                            <PlaygroundOutcomeCard
                                key={o.id}
                                label={o.name}
                                color={colors.get(o.id)}
                                probability={probs[i]}
                                multiplier={shares / stake}
                                fee={fee}
                                myStaked={myStakedByOutcome.get(i) ?? 0}
                                myShares={mySharesByOutcome.get(i) ?? 0}
                                stake={stake}
                                disabled={frozen || awaits}
                                onBuy={() => handleBuy(i)}
                                isWinner={resolution?.outcomeIndex === i}
                            />
                        );
                    })}
                </div>
                <p className="text-xs text-muted-foreground">
                    {playerName} ставит {stake} рейтинга: множитель показывает, сколько голосов
                    принесёт каждый потраченный 1 рейтинга в этой транзакции. Комиссия
                    поручителям уже включена в эту сумму.
                </p>
            </div>

            {/* ── Поручители (всегда развёрнуты) ── */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">Поручители</CardTitle>
                        {state.guarantees.length > 0 && (
                            <Badge variant="secondary" className="shrink-0">
                                Обеспечили {formatAmount(totalRisk(state))} из {formatAmount(state.maxGuarantorLoss)}
                            </Badge>
                        )}
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Как работают поручители"
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                    <InfoIcon className="size-4" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 space-y-2 text-xs text-muted-foreground">
                                <p className="font-medium text-foreground">Как работают поручители</p>
                                <p>
                                    Риск поручителей задаёт ликвидность b = min(L, Σрисков)/ln(n), а их комиссия
                                    становится надбавкой к цене голоса. Вхождение нового поручителя пересчитывает b
                                    при неизменных позициях — цены сдвигаются к равномерным.
                                </p>
                            </PopoverContent>
                        </Popover>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {state.guarantees.length > 0 && (
                        <table className="w-full table-fixed text-sm">
                            <thead>
                                <tr className="text-xs text-muted-foreground">
                                    <th className="text-left font-normal">Поручитель</th>
                                    <th className="w-20 text-right font-normal">Риск</th>
                                    <th className="w-16 text-right font-normal">Комиссия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {squashIdentical(state.guarantees).map((row) => (
                                    <tr key={row.key}>
                                        <td className="py-0.5 pr-2 truncate">{row.name}</td>
                                        <td className="py-0.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                                            {formatAmount(row.risk)}
                                        </td>
                                        <td className="py-0.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                                            {row.feeRate > 0 ? formatPercent(row.feeRate) : "0%"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <div className="space-y-2 pt-2 border-t">
                        <p className="text-xs font-medium">Стать поручителем ({playerName})</p>
                        <label className="block space-y-1">
                            <span className="text-xs text-muted-foreground">Риск</span>
                            <input
                                className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                                type="number"
                                min={0.5}
                                step="any"
                                placeholder="4"
                                value={risk}
                                onChange={(e) => setRisk(e.target.value)}
                                disabled={frozen}
                            />
                        </label>
                        <div className="space-y-1">
                            <span className="text-xs text-muted-foreground">Комиссия</span>
                            <div className="grid grid-cols-4 gap-1">
                                {QUICK_FEE_VALUES.map((v) => (
                                    <Button
                                        key={v}
                                        type="button"
                                        variant={feePercent === v ? "default" : "outline"}
                                        aria-pressed={feePercent === v}
                                        className="h-7 px-0 text-xs"
                                        onClick={() => setFeePercent(v)}
                                        disabled={frozen}
                                    >
                                        {v}%
                                    </Button>
                                ))}
                            </div>
                        </div>
                        <Button
                            size="sm"
                            className="w-full"
                            onClick={handleJoin}
                            disabled={frozen || feePercent == null}
                        >
                            Стать поручителем
                        </Button>
                        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                    </div>
                </CardContent>
            </Card>

            {/* ── История вероятностей ── */}
            {state.points.length >= 2 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">История вероятностей</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ProbabilityChart points={state.points} outcomes={outcomes} nameOf={nameOf} />
                        <p className="text-xs text-muted-foreground pt-1">
                            Одна точка на действие: ставка сдвигает цену купленного исхода вверх,
                            вхождение поручителя сдвигает все цены к равномерным.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* ── Расчёт ── */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Расчёт рынка</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {state.bets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Сделайте хотя бы одну ставку, чтобы разрешить рынок.
                        </p>
                    ) : resolution == null ? (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Выберите, какой исход сбудется, — выплаты игрокам и поручителям
                                посчитаются по настоящему алгоритму расчёта.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {outcomes.map((o, i) => (
                                    <Button
                                        key={o.id}
                                        variant="outline"
                                        size="sm"
                                        className="border-2"
                                        style={{ borderColor: colors.get(o.id) }}
                                        onClick={() => handleResolve(i)}
                                    >
                                        {o.name}
                                    </Button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <ResolutionView resolution={resolution} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function ResolutionView({ resolution }: { resolution: PlaygroundResolution }) {
    return (
        <div className="space-y-3">
            {resolution.players.length > 0 && (
                <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">Игроки (поставлено → получено)</p>
                    <SettlementList details={resolution.players} />
                </div>
            )}
            {resolution.guarantors.length > 0 && (
                <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">Поручители (итог по каждому)</p>
                    <SettlementList details={resolution.guarantors} showFlow={false} />
                </div>
            )}
            <Separator />
            <p className="text-xs text-muted-foreground">
                Комиссий собрано: {formatAmount(resolution.feeCollected)} · Остаток рынка
                (собранное − выплаченное, без комиссий): {formatAmount(resolution.residual)} —
                он распределяется между поручителями по алгоритму из статьи.
            </p>
            <p className="text-xs text-muted-foreground">
                Сумма всех изменений равна нулю: проигранные рейтинги игроков в точности
                распределяются между победителями и поручителями.
            </p>
        </div>
    );
}
