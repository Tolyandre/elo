"use client"

import { useEffect, useMemo } from "react"
import { useForm, FormProvider, useWatch } from "react-hook-form"
import * as mathjs from "mathjs"

import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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

import {
    Suit,
    Special,
    Card as GameCard,
    suitValues,
    specialValues,
    calculateProbabilities1,
} from "./skull-king"

import { RHFField } from "@/components/rhf-field"
import { Fraction } from "mathjs"

const suitLabels: Record<Suit, string> = {
    "jolly-roger": "Весёлый Роджер",
    chest: "Сундук",
    parrot: "Попугай",
    map: "Карта",
}

const specialLabels: Record<Special, string> = {
    "skull-king": "Король черепов",
    pirate: "Пират",
    tigress: "Тигрица",
    mermaid: "Русалка",
    escape: "Белый флаг",
    kraken: "Кракен",
    "white-whale": "Белый кит",
}

type FormValues = {
    numberOfPlayers: number
    turnOrder: number
    krakenEnabled: boolean
    whiteWhaleEnabled: boolean
    cardType: Suit | Special | null
    suitValue: number
}

export function SkullKingCalculator() {
    const form = useForm<FormValues>({
        defaultValues: {
            numberOfPlayers: 4,
            turnOrder: 1,
            krakenEnabled: false,
            whiteWhaleEnabled: false,
            cardType: null,
            suitValue: 1,
        },
    })

    const numberOfPlayers = useWatch({
        control: form.control,
        name: "numberOfPlayers",
    })

    const turnOrder = useWatch({
        control: form.control,
        name: "turnOrder",
    })

    const krakenEnabled = useWatch({
        control: form.control,
        name: "krakenEnabled",
    })

    const whiteWhaleEnabled = useWatch({
        control: form.control,
        name: "whiteWhaleEnabled",
    })

    const cardType = useWatch({
        control: form.control,
        name: "cardType",
    })

    const suitValue = useWatch({
        control: form.control,
        name: "suitValue",
    })


    /* ----------------------- derived game state ----------------------- */

    const availableSpecials = useMemo<Special[]>(() => {
        return [
            ...specialValues.filter(
                (s) => s !== "kraken" && s !== "white-whale",
            ),
            ...(krakenEnabled ? ["kraken" as Special] : []),
            ...(whiteWhaleEnabled ? ["white-whale" as Special] : []),
        ]
    }, [krakenEnabled, whiteWhaleEnabled])


    const card: GameCard | null = useMemo(() => {
        if (!cardType) return null

        if (suitValues.includes(cardType as Suit)) {
            if (!suitValue) return null

            return {
                type: cardType as Suit,
                value: suitValue,
            }
        }

        return { type: cardType as Special }
    }, [cardType, suitValue])

    const probabilities = useMemo(() => {
        if (
            !numberOfPlayers ||
            !turnOrder ||
            !card
        ) {
            return null
        }

        return calculateProbabilities1(
            numberOfPlayers,
            turnOrder,
            card,
            krakenEnabled ?? false,
            whiteWhaleEnabled ?? false,
        )
    }, [
        numberOfPlayers,
        turnOrder,
        card,
        krakenEnabled,
        whiteWhaleEnabled,
    ])

    const mathExpectation = useMemo<number | null>(() => {
        if (!probabilities) {
            return null;
        }

        return mathjs.number(probabilities.reduce((acc, { probability, points }) => new Fraction(acc).add(probability.mul(points)), new Fraction(0)));
    }, [probabilities]);

    /* ----------------------------- effects ---------------------------- */

    useEffect(() => {
        if (
            !numberOfPlayers ||
            !turnOrder
        ) {
            return
        }

        if (turnOrder > numberOfPlayers) {
            form.setValue(
                "turnOrder",
                numberOfPlayers,
            )
        }
    }, [numberOfPlayers, turnOrder])


    /* ----------------------------- render ----------------------------- */

    return (
        <FormProvider {...form}>
            <div className="space-y-6 max-w-md">
                <h2 className="text-xl font-semibold">
                    Калькулятор первого раунда
                </h2>
            </div>
            <div className="mx-auto max-w-md space-y-6">
                <Card>
                    <CardContent className="space-y-6">
                        <Field orientation="horizontal">
                            <FieldTitle>Кракен в игре</FieldTitle>
                            <Switch
                                checked={krakenEnabled}
                                onCheckedChange={(v) =>
                                    form.setValue("krakenEnabled", v)
                                }
                            />
                        </Field>

                        <Field orientation="horizontal">
                            <FieldTitle>Белый кит в игре <span className="text-xs text-muted-foreground">(не реализовано)</span></FieldTitle>
                            <Switch
                                checked={whiteWhaleEnabled}
                                onCheckedChange={(v) =>
                                    form.setValue("whiteWhaleEnabled", v)
                                }
                                disabled={true}
                            />
                        </Field>

                        <Separator />

                        <RHFField
                            name="cardType"
                            label="Ваша карта"
                        >
                            {({ value, onChange }) => (
                                <Select
                                    value={value ?? undefined}
                                    onValueChange={onChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Выберите карту" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectLabel>
                                                Масти
                                            </SelectLabel>
                                            {suitValues.map((suit) => (
                                                <SelectItem
                                                    key={suit}
                                                    value={suit}
                                                >
                                                    {suitLabels[suit]}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>

                                        <SelectGroup>
                                            <SelectLabel>
                                                Специальные
                                            </SelectLabel>
                                            {availableSpecials.map(
                                                (special) => (
                                                    <SelectItem
                                                        key={special}
                                                        value={special}
                                                    >
                                                        {specialLabels[special]}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            )}
                        </RHFField>

                        {cardType && suitValues.includes(cardType as Suit) && (
                            <RHFField
                                name="suitValue"
                                label={`Номинал карты: ${suitValue}`}
                            >
                                {({ value, onChange }) => (
                                    <Slider
                                        min={1}
                                        max={14}
                                        step={1}
                                        value={[value]}
                                        onValueChange={([v]) =>
                                            onChange(v)
                                        }
                                    />
                                )}
                            </RHFField>
                        )}

                        <Separator />

                        <RHFField
                            name="numberOfPlayers"
                            label={`Количество игроков: ${numberOfPlayers}`}
                        >
                            {({ value, onChange }) => (
                                <Slider
                                    min={2}
                                    max={8}
                                    step={1}
                                    value={[value]}
                                    onValueChange={([v]) =>
                                        onChange(v)
                                    }
                                />
                            )}
                        </RHFField>

                        <RHFField
                            name="turnOrder"
                            label={`Порядок хода: ${turnOrder}`}
                        >
                            {({ value, onChange }) => (
                                <Slider
                                    min={1}
                                    max={numberOfPlayers}
                                    step={1}
                                    value={[value]}
                                    onValueChange={([v]) =>
                                        onChange(v)
                                    }
                                />
                            )}
                        </RHFField>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>
                            Результат (заявка 1)
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Мат. ожидание
                            </span>
                            <span className="font-mono">
                                {mathExpectation?.toFixed(2) ?? "—"}
                            </span>
                        </div>

                        <Separator />

                        {probabilities && (<div className="flex justify-between">
                            Вероятности
                        </div>
                        )}
                        {/* {probabilities && (<div className="space-y-2 text-muted-foreground">
                            Сумма вероятностей для контроля: <pre>{(mathjs.number(probabilities?.reduce((acc, { probability }) => acc.add(probability), new Fraction(0))) * 100).toFixed(2)}%</pre>
                        </div>
                        )} */}

                        {probabilities?.map(
                            ({ probability, points }, i) => (
                                <div
                                    key={i}
                                    className="flex justify-between font-mono"
                                >
                                    <span>
                                        {(mathjs.number(probability) * 100).toFixed(2)}%
                                    </span>
                                    <span>{points} очков</span>
                                </div>
                            ),
                        )}
                    </CardContent>
                </Card>
            </div>
        </FormProvider>
    )
}
