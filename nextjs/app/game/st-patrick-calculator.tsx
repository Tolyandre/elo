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

function BlackCardsInput({
    name,
    cardsInHand,
    opponentsCardsInHand,
    maxPlayedCount,
}: {
    name: string
    cardsInHand: number
    opponentsCardsInHand: number
    maxPlayedCount: number
}) {
    const { field } = useController({ name: name as any });
    const cards: CardState[] = field.value ?? [];

    const myCount = cards.filter((v) => v === "me").length;
    const opponentsCount = cards.filter((v) => v === "opponents").length;
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

    return (
        <div className="space-y-3">
            <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                <span>У меня: <span className={cn("font-medium", myCount > cardsInHand && "text-destructive")}>{myCount}</span> / {cardsInHand}</span>
                <span>У соперников: <span className={cn("font-medium", opponentsCount > opponentsCardsInHand && "text-destructive")}>{opponentsCount}</span> / {opponentsCardsInHand}</span>
                <span>Вышли: <span className={cn("font-medium", playedCount > maxPlayedCount && "text-destructive")}>{playedCount}</span> / {maxPlayedCount}</span>
            </div>

            <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 9 }).map((_, idx) => {
                    const state: CardState = cards[idx] ?? "opponents";
                    return (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => toggle(idx)}
                            className={cn(
                                "flex flex-col items-center justify-center rounded border text-xs font-semibold h-12 select-none transition-colors",
                                state === "me" && "bg-primary text-primary-foreground border-primary",
                                state === "opponents" && "bg-background text-foreground border-input hover:bg-accent",
                                state === "played" && "bg-muted text-muted-foreground border-muted",
                            )}
                        >
                            <span className={cn(state === "played" && "line-through")}>{idx + 1}</span>
                            <span className="text-[9px] font-normal leading-tight mt-0.5">
                                {state === "me" ? "я" : state === "played" ? "вышла" : ""}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border border-primary bg-primary" /> у меня</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border border-input" /> у соперников</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-muted border border-muted" /> вышла</span>
            </div>
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
                                cardsInHand={cardsInHand}
                                opponentsCardsInHand={opponentsCardsInHand}
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

                    <CardContent>
                        {!((form.formState.errors as any).blackCards) ? (
                            probabilitiesPerMyCard && probabilitiesPerMyCard.length > 0 ? (
                                <div className="space-y-3">
                                    {probabilitiesPerMyCard.map((p) => (
                                        <div key={p.index} className="text-sm text-muted-foreground">
                                            <div className="font-medium">Карта {p.index + 1}</div>
                                            <div>Один из соперников обязан забрать взятку: {(p.opponentsMustWin * 100).toFixed(2)}%</div>
                                        </div>
                                    ))}
                                </div>
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
