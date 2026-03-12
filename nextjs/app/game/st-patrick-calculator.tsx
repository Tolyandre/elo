"use client"

import { useEffect, useMemo } from "react"
import { useForm, FormProvider, useWatch, useController } from "react-hook-form"

import { Slider } from "@/components/ui/slider"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import { RHFField } from "@/components/rhf-field"
import { forcedToTakeProbability } from "./st-patrick"

const totalCards = 36;

type CardState = "me" | "opponents" | "played"

type FormValues = {
    numberOfPlayers: 3 | 4
    roundNumber: number
    blackCards: CardState[]
}

function formatProbability(p: number): string {
    const pct = p * 100;
    if (pct.toFixed(2) === "100.00" && p < 1) {
        return pct.toFixed(4) + "%";
    }
    return pct.toFixed(2) + "%";
}

function computeProbabilities(
    numberOfPlayers: number,
    roundNumber: number,
    blackCards: CardState[],
) {
    const m = numberOfPlayers - 1;
    const n = totalCards / numberOfPlayers - roundNumber + 1;

    const indices: number[] = [];
    blackCards.forEach((v, i) => {
        if (v === "me") indices.push(i);
    });

    return indices.map((idx) => {
        const L = blackCards.filter((c, i) => i < idx && c === "opponents").length;
        const H = blackCards.filter((c, i) => i > idx && c === "opponents").length;
        return {
            index: idx,
            opponentsMustWin: forcedToTakeProbability(m, n, L, H),
        };
    });
}

function CardTile({ idx, onClick }: { idx: number; state: CardState; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex items-center justify-center rounded border w-9 h-9 text-sm font-semibold select-none transition-colors shrink-0",
                "bg-background text-foreground border-input hover:bg-accent",
            )}
        >
            {idx + 1}
        </button>
    );
}

function BlackCardsInput({
    name,
    maxPlayedCount,
}: {
    name: string
    maxPlayedCount: number
}) {
    const { field } = useController({ name: name as any });
    const cards: CardState[] = field.value ?? [];

    const playedCount = cards.filter((v) => v === "played").length;

    function getNextState(current: CardState): CardState {
        if (current === "opponents") return "me";
        if (current === "me") {
            if (maxPlayedCount === 0 || playedCount >= maxPlayedCount) return "opponents";
            return "played";
        }
        return "opponents";
    }

    function toggle(idx: number) {
        const current: CardState = cards[idx] ?? "opponents";
        const next_cards = [...cards];
        next_cards[idx] = getNextState(current);
        field.onChange(next_cards);
    }

    const byState = (state: CardState) =>
        cards.map((s, i) => i).filter((i) => (cards[i] ?? "opponents") === state);

    const meCards = byState("me");
    const opponentsCards = byState("opponents");
    const playedCards = byState("played");
    const showPlayedSection = maxPlayedCount > 0 || playedCards.length > 0;

    return (
        <div className="space-y-3 text-sm">
            <div className="space-y-1">
                <div className="font-medium">У соперников на руках</div>
                <div className="flex flex-wrap gap-1 min-h-[2.5rem] items-start content-start">
                    {opponentsCards.length > 0
                        ? opponentsCards.map((i) => <CardTile key={i} idx={i} state="opponents" onClick={() => toggle(i)} />)
                        : <span className="text-muted-foreground self-center">—</span>}
                </div>
            </div>

            <div className="space-y-1">
                <div className="font-medium">У меня в руке</div>
                <div className="flex flex-wrap gap-1 min-h-[2.5rem] items-start content-start">
                    {meCards.length > 0
                        ? meCards.map((i) => <CardTile key={i} idx={i} state="me" onClick={() => toggle(i)} />)
                        : <span className="text-muted-foreground self-center">—</span>}
                </div>
            </div>

            {showPlayedSection && (
                <div className="space-y-1">
                    <div className="font-medium">Вышли</div>
                    <div className="flex flex-wrap gap-1 min-h-[2.5rem] items-start content-start">
                        {playedCards.length > 0
                            ? playedCards.map((i) => <CardTile key={i} idx={i} state="played" onClick={() => toggle(i)} />)
                            : <span className="text-muted-foreground self-center">—</span>}
                    </div>
                </div>
            )}
        </div>
    );
}


export function StPatrickCalculator() {
    const form = useForm<FormValues>({
        defaultValues: {
            numberOfPlayers: 4,
            roundNumber: 1,
            blackCards: Array.from({ length: 9 }).map(() => "opponents" as const),
        },
    })

    const numberOfPlayers = useWatch({
        control: form.control,
        name: "numberOfPlayers",
    })

    const roundNumber = useWatch({
        control: form.control,
        name: "roundNumber",
    })

    const blackCards = useWatch({
        control: form.control,
        name: "blackCards",
    })

    const cardsInHand = numberOfPlayers && roundNumber
        ? Math.floor(totalCards / numberOfPlayers) - roundNumber + 1
        : 0;
    const opponentsCardsInHand = numberOfPlayers ? cardsInHand * (numberOfPlayers - 1) : 0;
    const maxPlayedCount = numberOfPlayers && roundNumber
        ? Math.min(9, (roundNumber - 1) * numberOfPlayers)
        : 0;

    /* ----------------------------- effects ---------------------------- */

    useEffect(() => {
        if (!numberOfPlayers || !roundNumber) return;

        const maxRounds = Math.floor(totalCards / numberOfPlayers);
        if (roundNumber > maxRounds) {
            form.setValue("roundNumber", maxRounds);
        }
    }, [numberOfPlayers, roundNumber])

    /* validation for black cards */
    useEffect(() => {
        if (!blackCards || !numberOfPlayers || !roundNumber) return;

        const myCount = blackCards.filter((v) => v === "me").length;
        const opponentsCount = blackCards.filter((v) => v === "opponents").length;
        const playedCount = blackCards.filter((v) => v === "played").length;

        if (playedCount > maxPlayedCount) {
            form.setError("blackCards", {
                type: "manual",
                message: roundNumber === 1
                    ? `В первом раунде не может быть вышедших карт`
                    : `Вышедших карт не может быть больше ${maxPlayedCount} в раунде ${roundNumber}`,
            });
        } else if (myCount > cardsInHand) {
            form.setError("blackCards", {
                type: "manual",
                message: `Количество карт 'у меня' не должно превышать ${cardsInHand}`,
            });
        } else if (opponentsCount > opponentsCardsInHand) {
            form.setError("blackCards", {
                type: "manual",
                message: `Количество карт 'у соперников' не должно превышать ${opponentsCardsInHand}`,
            });
        } else {
            form.clearErrors("blackCards" as any);
        }
    }, [blackCards, numberOfPlayers, roundNumber])


    const probabilitiesPerMyCard = useMemo(() => {
        if ((form.formState.errors as any).blackCards) return null;
        if (!numberOfPlayers || !roundNumber || !blackCards) return null;

        return computeProbabilities(numberOfPlayers, roundNumber, blackCards);
    }, [numberOfPlayers, roundNumber, blackCards, (form.formState.errors as any)?.blackCards])


    /* ----------------------------- render ----------------------------- */

    return (
        <FormProvider {...form}>
            <div className="space-y-6 max-w-md">
                <h2 className="text-xl font-semibold">
                    Калькулятор взятки
                </h2>
            </div>
            <div className="mx-auto max-w-md space-y-6">
                <Card>
                    <CardContent className="space-y-6">
                        <RHFField name="numberOfPlayers" label="Количество игроков:">
                            {({ value, onChange }) => (
                                <div className="flex gap-4">
                                    <label className="inline-flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="numberOfPlayers"
                                            value={3}
                                            checked={value === 3}
                                            onChange={() => onChange(3)}
                                        />
                                        <span>3</span>
                                    </label>

                                    <label className="inline-flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="numberOfPlayers"
                                            value={4}
                                            checked={value === 4}
                                            onChange={() => onChange(4)}
                                        />
                                        <span>4</span>
                                    </label>
                                </div>
                            )}
                        </RHFField>

                        <RHFField name="roundNumber" label={`Номер раунда: ${roundNumber}`}>
                            {({ value, onChange }) => (
                                <Slider
                                    min={1}
                                    max={Math.floor(totalCards / (numberOfPlayers || 4))}
                                    step={1}
                                    value={[value]}
                                    onValueChange={([v]) => onChange(v)}
                                />
                            )}
                        </RHFField>

                        <Separator />

                        <div>
                            <h3 className="text-sm font-medium mb-3">Чёрные карты <span className="text-muted-foreground font-normal">(нажмите чтобы изменить)</span></h3>

                            <BlackCardsInput
                                name="blackCards"
                                maxPlayedCount={maxPlayedCount}
                            />

                            {form.formState.errors && (form.formState.errors as any).blackCards && (
                                <div className="text-sm text-destructive mt-2">{(form.formState.errors as any).blackCards.message}</div>
                            )}
                        </div>

                        <Separator />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>
                            Вы ходите первым
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-3">
                        <p className="text-sm">
                            Вероятность что хотя бы один из соперников
                            будет вынужден взять взятку, если вы заходите с карты:
                        </p>
                        {!((form.formState.errors as any).blackCards) ? (
                            probabilitiesPerMyCard && probabilitiesPerMyCard.length > 0 ? (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b text-muted-foreground">
                                            <th className="text-left font-medium pb-2 pr-4 w-16">Карта</th>
                                            <th className="text-left font-medium pb-2">Один из соперников обязан забрать</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {probabilitiesPerMyCard.map((p) => (
                                            <tr key={p.index} className="border-b last:border-0">
                                                <td className="py-2 pr-4">
                                                    <div className="flex items-center justify-center rounded border w-9 h-9 text-sm font-semibold bg-background text-foreground border-input select-none">
                                                        {p.index + 1}
                                                    </div>
                                                </td>
                                                <td className="py-2 font-medium">
                                                    {formatProbability(p.opponentsMustWin)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="text-sm text-muted-foreground">Отметьте карты «у меня» чтобы увидеть результаты.</div>
                            )
                        ) : (
                            <div className="text-sm text-muted-foreground">Исправьте ошибки валидации чтобы увидеть результаты.</div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </FormProvider>
    )
}
