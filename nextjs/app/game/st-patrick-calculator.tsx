"use client"

import { useEffect, useMemo } from "react"
import { useForm, FormProvider, useWatch } from "react-hook-form"
import * as mathjs from "mathjs"

import { Slider } from "@/components/ui/slider"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
    Field,
    FieldTitle,
} from "@/components/ui/field"


import { RHFField } from "@/components/rhf-field"
import { combinations, Fraction } from "mathjs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

const totalCards = 36;

type FormValues = {
    numberOfPlayers: 3 | 4
    roundNumber: number
    blackCards: ("me" | "opponents" | "played")[]
}

/* placeholder calculation function */
const computeProbabilitiesPlaceholder = (
    numberOfPlayers: number,
    roundNumber: number,
    cards: ("me" | "opponents" | "played")[],
    cardIndex: number,
) => {

    const opponentsRemainingLowerCardsCount = cards.filter((c, i) => cardIndex > i && c === "opponents").length;
    const opponentsRemainingHigherCardsCount = cards.filter((c, i) => cardIndex < i && c === "opponents").length;

    const cardsInHand = totalCards / numberOfPlayers - roundNumber + 1;
    const opponentsCardsInHand = (numberOfPlayers - 1) * cardsInHand;
    const opponentsNonBlackCards = opponentsCardsInHand - (opponentsRemainingHigherCardsCount + opponentsRemainingLowerCardsCount);

    // const pOpponentHasNoLowerBlackCard = new Fraction(
    //     mathjs.combinations(otherPlayersNonBlackCards + remainingHigherCardsCount, cardsInHand),
    //     mathjs.combinations(cardsInHand * numberOfPlayers, cardsInHand));

    // const otherP = otherPlayerOnlyHigerCardsProbability(opponentsRemainingHigherCardsCount, opponentsRemainingLowerCardsCount, cardsInHand, numberOfPlayers);
    // const opponentsMustWin = mathjs.number(
    //     new Fraction(1)
    //         .sub(
    //             (new Fraction(1).sub(otherP)).pow(numberOfPlayers - 1)
    //         )
    // );

    const opponentsMustWin = forcedTrickProbability(
        numberOfPlayers,
        opponentsCardsInHand,
        opponentsRemainingLowerCardsCount,
        opponentsRemainingHigherCardsCount
    );

    return { opponentsMustWin };
}

// function otherPlayerOnlyHigerCardsProbability(opponentsRemainingHigherCardsCount: number, opponentsRemainingLowerCardsCount: number,
//     cardsInHand: number, numberOfPlayers: number
// ): Fraction {
//     //let enumerator = new Fraction(0);

//     // for (let j = 1; j <= mathjs.min(cardsInHand, opponentsRemainingHigherCardsCount); j++) {
//     //     enumerator = enumerator.add(mathjs.combinations(opponentsRemainingHigherCardsCount, j) *
//     //         mathjs.combinations(opponentsNonBlackCards, cardsInHand - j));
//     // }

//     // return enumerator.div(mathjs.combinations(cardsInHand * numberOfPlayers, cardsInHand));

//     const opponentsTotalCards = cardsInHand * (numberOfPlayers - 1);
//     const enumerator = mathjs.combinations(opponentsTotalCards - opponentsRemainingLowerCardsCount, cardsInHand) -
//         mathjs.combinations(opponentsTotalCards - opponentsRemainingHigherCardsCount - opponentsRemainingLowerCardsCount, cardsInHand);
//     return new Fraction(enumerator, mathjs.combinations(opponentsTotalCards, cardsInHand));
// }

/**
 * Точная вероятность того, что хотя бы один соперник
 * будет обязан взять взятку
 */
export function forcedTrickProbability(
    numberOfPlayers: number,
    remainsCardsTotal: number,
    remainingLowerCardsCount: number,
    remainingHigherCardsCount: number
): number {
    const N = numberOfPlayers - 1;
    const T = remainsCardsTotal; // - 1;
    const L = remainingLowerCardsCount;
    const H = remainingHigherCardsCount;
    const O = T - L - H;

    if (T % N !== 0) {
        throw new Error("Карты распределены не поровну");
    }

    if (remainingLowerCardsCount === 0 && remainingHigherCardsCount > 0) {
        return 1;
    }


    const k = T / N;

    let probabilityNoForced = 0;

    for (let m = 0; m <= N; m++) {
        const sign = m % 2 === 0 ? 1 : -1;
        let term = 0;

        const hMin = m;
        const hMax = Math.min(H, m * k);

        for (let h = hMin; h <= hMax; h++) {
            const other = m * k - h;
            if (other > O) continue;

            // вероятность, что выбранные m игроков получили именно эти карты
            const p =
                comb(H, h) *
                comb(O, other) /
                comb(T, m * k);

            term += p;
        }

        probabilityNoForced += sign * comb(N, m) * term;
    }

    return 1 - probabilityNoForced;
}

function comb(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) {
        r *= (n - k + i) / i;
    }
    return r;
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


    /* ----------------------- derived game state ----------------------- */



    /* ----------------------------- effects ---------------------------- */

    useEffect(() => {
        if (!numberOfPlayers || !roundNumber) {
            return
        }

        const maxRounds = Math.floor(36 / numberOfPlayers)

        if (roundNumber > maxRounds) {
            form.setValue("roundNumber", maxRounds);
        }

    }, [numberOfPlayers, roundNumber])


    /* validation for black cards */
    useEffect(() => {
        if (!blackCards || !numberOfPlayers || !roundNumber) return
        const maxMyCards = (36 / numberOfPlayers) + roundNumber - 1
        const myCount = blackCards.filter((v) => v === "me").length

        if (myCount > maxMyCards) {
            form.setError("blackCards" as any, {
                type: "manual",
                message: `Количество карт 'карта у меня' не должно превышать ${maxMyCards}`,
            })
        } else {
            form.clearErrors("blackCards" as any)
        }
    }, [blackCards, numberOfPlayers, roundNumber])




    const probabilitiesPerMyCard = useMemo(() => {
        if ((form.formState.errors as any).blackCards) return null
        if (!numberOfPlayers || !roundNumber || !blackCards) return null

        const indices: number[] = []
        blackCards.forEach((v, i) => {
            if (v === "me") indices.push(i)
        })

        return indices.map((idx) => ({
            index: idx,
            ...computeProbabilitiesPlaceholder(numberOfPlayers, roundNumber, blackCards, idx),
        }))
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
                        <RHFField name="numberOfPlayers" label={`Количество игроков:`}>
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
                                    max={Math.floor(36 / (numberOfPlayers || 4))}
                                    step={1}
                                    value={[value]}
                                    onValueChange={([v]) => onChange(v)}
                                />
                            )}
                        </RHFField>

                        <Separator />

                        <div>
                            <h3 className="text-sm font-medium">Чёрные карты</h3>

                            <div className="space-y-3 mt-3">
                                {Array.from({ length: 9 }).map((_, idx) => (
                                    <RHFField
                                        key={idx}
                                        name={`blackCards.${idx}` as any}
                                        label={`${idx + 1}`}
                                    >
                                        {({ value, onChange }) => (
                                            <div className="flex flex-col gap-2">
                                                <RadioGroup value={value ?? undefined} onValueChange={onChange}>
                                                    <div className="flex gap-6">
                                                        <div className="flex items-center gap-2">
                                                            <RadioGroupItem value="me" id={`black-${idx}-me`} />
                                                            <label htmlFor={`black-${idx}-me`}>у меня</label>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            <RadioGroupItem value="opponents" id={`black-${idx}-opponents`} />
                                                            <label htmlFor={`black-${idx}-opponents`}>у соперников</label>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            <RadioGroupItem value="played" id={`black-${idx}-played`} />
                                                            <label htmlFor={`black-${idx}-played`}>вышла</label>
                                                        </div>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        )}
                                    </RHFField>
                                ))}
                            </div>

                            {/* validation message for blackCards */}
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
                        {/* perform calculation only when there are no validation errors */}
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
                                <div className="text-sm text-muted-foreground">У вас нет карт в руке или заполните форму чтобы увидеть результаты.</div>
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
