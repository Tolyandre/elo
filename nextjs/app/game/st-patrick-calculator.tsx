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

    // const opponentsMustWin = forcedEatingProbability(
    //     numberOfPlayers,
    //     cardsInHand,
    //     opponentsRemainingLowerCardsCount,
    //     opponentsRemainingHigherCardsCount
    // );

    const opponentsMustWin = opponentMustWinProbability(numberOfPlayers, cardsInHand,
         opponentsRemainingLowerCardsCount, opponentsRemainingHigherCardsCount);

    return { opponentsMustWin };
}

export function opponentMustWinProbability(
    NumberOfPlayers: number,
    CardsInHand: number,
    OpponentsLowerBlackCards: number,
    OpponentsHigherBlackCards: number
): number {

    let winWays = 0;
    const totalWays = mathjs.combinations(CardsInHand * (NumberOfPlayers - 1), CardsInHand);

    for (let l = 0; l <= mathjs.min(OpponentsLowerBlackCards, CardsInHand); l++) {
        for (let h = 0; h <= mathjs.min(OpponentsHigherBlackCards, CardsInHand - l); h++) {
            const nonBlackCards = CardsInHand - l - h;
            const ways = mathjs.combinations(OpponentsLowerBlackCards, l) *
                mathjs.combinations(OpponentsHigherBlackCards, h) *
                mathjs.combinations(
                    CardsInHand * (NumberOfPlayers - 1) - OpponentsLowerBlackCards - OpponentsHigherBlackCards,
                    nonBlackCards
                );

            if (l > 0 && h === 0) {
               // winWays -= ways;
            }
            else {
                winWays += ways;
            }
        }
    }
    if (winWays <= NumberOfPlayers-1){
        return 1;
    }

    return mathjs.combinations(winWays, NumberOfPlayers-1) / mathjs.combinations(totalWays, NumberOfPlayers-1);
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
 * Вероятность того, что хотя бы один из соперников будет вынужден «съесть» карту.
 *
 * @param NumberOfPlayers  количество игроков (2, 3 или 4)
 * @param CardsInHand      сколько карт осталось у каждого игрока
 * @param OpponentsLowerBlackCards  суммарное число «нижних» карт у всех соперников
 * @param OpponentsHigherBlackCards суммарное число «выше» карт у всех соперников
 * @returns 0 ≤ probability ≤ 1
 */
export function forcedEatingProbability(
    NumberOfPlayers: number,
    CardsInHand: number,
    OpponentsLowerBlackCards: number,
    OpponentsHigherBlackCards: number
): number {

    // ------------------------------------------------------------------
    // 1. Подготовительные величины
    // ------------------------------------------------------------------
    const m = NumberOfPlayers - 1;          // число соперников
    const n = CardsInHand;                  // карт у одного игрока
    const N = m * n;                        // общее число слотов у соперников
    const L = OpponentsLowerBlackCards;     // число нижних карт
    const H = OpponentsHigherBlackCards;    // число верхних карт
    const M = N - L;                        // слоты, в которые можно поставить верхние карты

    // ------------------------------------------------------------------
    // 2. Функция биномиальных коэффициентов (с использованием BigInt для
    //    надёжности, но в наших диапазонах можно безопасно перейти к Number)
    // ------------------------------------------------------------------
    const comb = (a: number, b: number): bigint => {
        if (b < 0 || b > a) return 0n;
        if (b === 0 || b === a) return 1n;
        const k = Math.min(b, a - b);
        let res = 1n;
        for (let i = 1; i <= k; ++i) {
            res = res * BigInt(a - k + i) / BigInt(i);
        }
        return res;
    };

    // ------------------------------------------------------------------
    // 3. Полный «факториал» всех возможных размещений карт
    // ------------------------------------------------------------------
    const totalWays = comb(N, L) * comb(N - L, H);

    // ------------------------------------------------------------------
    // 4. Перебираем k = 1 … m (наибольший m = 3, т.к. NumberOfPlayers ≤ 4)
    // ------------------------------------------------------------------
    let probability = 0; // конечный ответ
    for (let k = 1; k <= m; ++k) {

        // 4.1. Число размещений нижних карт, которые «выкладываются» в слоты,
        //      оставшиеся от k игроков (они все без нижних карт)
        const lowerComb = L == 0 ? 0n : comb(N - k * n, L);
        // const lowerComb = BigInt(mathjs.combinations(N - k * n, L));

        // 4.2. Число размещений верхних карт, при которых каждый из k игроков
        //      получает хотя бы одну верхнюю карту (включённое‑исключение)
        let innerSum = 0n;
        for (let j = 0; j <= k; ++j) {
            const sign = (j % 2 === 0) ? 1n : -1n;
            const slots = M - j * n;      // сколько слотов остаётся, если j групп исключить
            if (slots < H) continue;      // нельзя разместить H верхних
            const term = sign * comb(k, j) * comb(slots, H);
            innerSum += term;
        }

        // 4.3. Число размещений, при которых конкретный набор из k игроков
        //      является «обязательными» (формула (5))
        const countFk = lowerComb * innerSum;

        // 4.4. Вероятность пересечения (формула (6))
        const pk = Number(countFk) / Number(totalWays);

        // 4.5. Инклюзи‑эксклюзи‑свойство (формула (7))
        probability += ((k % 2 === 1) ? pk : -pk);
    }

    return probability;
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

        const maxCardInHand = (totalCards / numberOfPlayers) - roundNumber + 1
        const myCount = blackCards.filter((v) => v === "me").length
        const opponentsCardsCount = blackCards.filter((v) => v === "opponents").length

        if (myCount > maxCardInHand) {
            form.setError("blackCards", {
                type: "manual",
                message: `Количество карт 'у меня' не должно превышать ${maxCardInHand}`,
            })
        } else if (opponentsCardsCount > maxCardInHand * (numberOfPlayers - 1)) {
            form.setError("blackCards", {
                type: "manual",
                message: `Количество карт 'у соперников' не должно превышать ${maxCardInHand * (numberOfPlayers - 1)}`,
            })
        } else if (myCount + opponentsCardsCount > maxCardInHand * (numberOfPlayers)) {
            form.setError("blackCards", {
                type: "manual",
                message: `Общее количество карт 'у меня' и 'у соперников' не должно превышать ${maxCardInHand * (numberOfPlayers)}`,
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
