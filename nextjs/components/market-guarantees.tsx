"use client";

import React, { useState } from "react";
import { InfoIcon } from "lucide-react";
import { MarketDetail, MarketGuarantee, createGuaranteePromise } from "@/app/api";
import { formatAmount } from "@/app/markets/format";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClubIcons } from "@/components/player-name";

function formatPercent(rate: number): string {
    const pct = (rate * 100).toFixed(1).replace(/\.0$/, "");
    return `${pct}%`;
}

/** One display row: a player's wagers with an identical fee squashed into total risk. */
type playerGuaranteeRow = {
    key: string;
    playerId: string;
    name: string;
    risk: number;
    feeRate: number;
    title: string;
};

// The list squashes only fully identical wagers (same player, same fee) into
// one row; different fees stay separate. Settlement keeps the raw rows,
// because the join time affects fee attribution.
function squashIdentical(guarantees: MarketGuarantee[]): playerGuaranteeRow[] {
    const rows = new Map<string, playerGuaranteeRow>();
    for (const g of guarantees) {
        const key = `${g.player_id}:${g.fee_rate}`;
        const row = rows.get(key) ?? {
            key,
            playerId: g.player_id,
            name: g.player_name,
            risk: 0,
            feeRate: g.fee_rate,
            title: "",
        };
        row.risk += g.risk_amount;
        const at = new Date(g.placed_at).toLocaleString();
        row.title = row.title ? `${row.title}, ${at}` : at;
        rows.set(key, row);
    }
    // Biggest contributors first: higher fee earns more commissions (and stands
    // earlier in the loss waterfall), then the larger risk. Ties keep wager order.
    return [...rows.values()].sort((a, b) => b.feeRate - a.feeRate || b.risk - a.risk);
}

const DEFAULT_RISK = "4";
const QUICK_FEE_VALUES = [0, 1, 2, 5, 10, 15, 25];

/**
 * The "Поручители" section (ADR-20): guarantors are voluntary liquidity
 * providers. Each wager locks a risk amount (the guarantor's maximum loss,
 * reserved against the betting limit) and sets their maker fee — the higher
 * the fee, the bigger their share of the collected commissions and the
 * earlier they stand in the loss waterfall (zero-fee guarantors pay only when
 * the fee-charging ones are exhausted).
 */
export function MarketGuarantees({
    market,
    canJoin,
    disabledReason,
    onJoined,
}: {
    market: MarketDetail;
    canJoin: boolean;
    disabledReason: string;
    onJoined: () => void;
}) {
    const guarantees = market.guarantees ?? [];
    const totalRisk = guarantees.reduce((sum, g) => sum + g.risk_amount, 0);
    const L = market.max_guarantor_loss;
    const overSubscribed = totalRisk > L + 1e-9;
    const awaitsGuarantors = market.liquidity_b <= 0;

    const [risk, setRisk] = useState(DEFAULT_RISK);
    const [feePercent, setFeePercent] = useState<number | null>(null);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleJoin() {
        const riskAmount = parseFloat(risk.replace(",", "."));
        if (!(riskAmount > 0)) {
            setError("Укажите положительный размер риска");
            return;
        }
        if (feePercent == null) {
            setError("Выберите комиссию");
            return;
        }
        setJoining(true);
        setError(null);
        try {
            await createGuaranteePromise(market.id, riskAmount, feePercent / 100);
            setRisk(DEFAULT_RISK);
            setFeePercent(null);
            onJoined();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Не удалось стать поручителем");
        } finally {
            setJoining(false);
        }
    }

    return (
        <Accordion type="single" collapsible defaultValue={awaitsGuarantors ? "guarantees" : undefined}>
            <AccordionItem value="guarantees" className="border rounded-lg px-4">
                <AccordionTrigger className="text-sm py-3">Поручители</AccordionTrigger>
                <AccordionContent className="space-y-3 pb-4">
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <p>Поручители обеспечивают рынок рейтингом и получают комиссию со ставок.</p>
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Как работают поручители"
                                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                                >
                                    <InfoIcon className="size-3.5" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 space-y-2 text-xs text-muted-foreground">
                                <p className="font-medium text-foreground">Как работают поручители</p>
                                <p>
                                    Поручители обеспечивают рынок рейтингом: их риск задаёт ликвидность, а взамен они
                                    получают комиссию с каждой ставки. Чем больше риск и комиссия поручителя, тем больше его
                                    доход — и тем раньше он возмещает убытки рынка. Поручители без комиссии возмещают убытки
                                    в последнюю очередь. Риск поручителя входит в лимит ставок.
                                </p>
                                <p>
                                    Комиссия рынка уже входит в цену голоса. Надбавка максимальна при цене 0.5 и убывает
                                    к краям: при комиссии 5% голос за 0.5 обойдётся в 0.55 (+5% от выплаты голоса), а при
                                    цене 0.8 — в 0.832 (+3.2% от выплаты голоса).
                                </p>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {!awaitsGuarantors && (
                        <div className="space-y-1">
                            <div className="text-sm">
                                <span className="text-muted-foreground">Поручители обеспечили </span>
                                <span>
                                    {formatAmount(totalRisk)} <span className="text-muted-foreground">из </span> {formatAmount(L)}
                                    {overSubscribed && " (максимальная волатильность) "}
                                </span>
                            </div>
                            <table className="w-full table-fixed text-sm">
                                <thead>
                                    <tr className="text-xs text-muted-foreground">
                                        <th className="text-left font-normal">Поручитель</th>
                                        <th className="w-20 text-right font-normal">Риск</th>
                                        <th className="w-16 text-right font-normal">Комиссия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {squashIdentical(guarantees).map((row) => (
                                        <tr key={row.key} title={row.title}>
                                            <td className="py-0.5 pr-2">
                                                <span className="flex items-center gap-1 min-w-0">
                                                    <ClubIcons playerId={row.playerId} className="shrink-0" />
                                                    <span className="truncate">{row.name}</span>
                                                </span>
                                            </td>
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
                        </div>
                    )}

                    {market.status === "open" && (
                        <div className="space-y-2 pt-2 border-t">
                            <p className="text-xs font-medium">Стать поручителем</p>
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
                                    disabled={!canJoin || joining}
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
                                            disabled={!canJoin || joining}
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
                                disabled={!canJoin || joining || feePercent == null}
                            >
                                {joining ? "..." : "Стать поручителем"}
                            </Button>
                            {!canJoin && disabledReason && (
                                <p className="text-xs text-muted-foreground text-center">{disabledReason}</p>
                            )}
                            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                        </div>
                    )}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
}
