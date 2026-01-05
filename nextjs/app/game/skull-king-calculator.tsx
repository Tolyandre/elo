"use client";

import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Suit, Special, Card, suitValues, ProbabilityPoints, calculateProbabilities1, specialValues } from "./skull-king";

const suitLabels: Record<Suit, string> = {
    "jolly-roger": "Весёлый Роджер",
    chest: "Сундук",
    parrot: "Попугай",
    map: "Карта",
};

const specialLabels: Record<Special, string> = {
    "skull-king": "Король черепов",
    pirate: "Пират",
    tigress: "Тигрица",
    mermaid: "Русалка",
    escape: "Белый флаг",
    kraken: "Кракен",
    "white-whale": "Белый кит",
};

export function SkullKingCalculator() {
    const [numberOfPlayers, setNumberOfPlayers] = useState(4);
    const [turnOrder, setTurnOrder] = useState(1);

    const [krakenEnabled, setKrakenEnabled] = useState(false);
    const [whiteWhaleEnabled, setWhiteWhaleEnabled] = useState(false);

    const [selectedType, setSelectedType] = useState<Suit | Special | null>(null);
    const [suitValue, setSuitValue] = useState(1);
    const [card, setCard] = useState<Card | null>(null);

    /** расчет вероятности выиграть взятку */
    const probabilities1 = useMemo<ProbabilityPoints[] | null>(() => {
        if (!card) {
            return null;
        }

        return calculateProbabilities1(numberOfPlayers, turnOrder, card, krakenEnabled, whiteWhaleEnabled);
    }, [card, numberOfPlayers, turnOrder, krakenEnabled, whiteWhaleEnabled]);

    /** доступные специальные карты */
    const availableSpecials = useMemo<Special[]>(() => {
        return [
            ...specialValues.filter((s) => s !== "kraken" && s !== "white-whale"),
            ...(krakenEnabled ? ["kraken"] : []),
            ...(whiteWhaleEnabled ? ["white-whale"] : []),
        ];
    }, [krakenEnabled, whiteWhaleEnabled]);

    /** если выключили карту — сбрасываем выбор */
    useEffect(() => {
        if (
            selectedType &&
            !suitValues.includes(selectedType as Suit) &&
            !availableSpecials.includes(selectedType as Special)
        ) {
            setSelectedType(null);
        }
    }, [availableSpecials, selectedType]);

    /** ограничение порядка хода */
    useEffect(() => {
        if (turnOrder > numberOfPlayers) {
            setTurnOrder(numberOfPlayers);
        }
    }, [numberOfPlayers, turnOrder]);

    /** сборка Card */
    useEffect(() => {
        if (!selectedType) {
            setCard(null);
            return;
        }

        if (suitValues.includes(selectedType as Suit)) {
            setCard({
                type: selectedType as Suit,
                value: suitValue,
            });
        } else {
            setCard({
                type: selectedType as Special,
            });
        }
    }, [selectedType, suitValue]);

    return (
        <div className="space-y-6 max-w-md">
            <h2 className="text-xl font-semibold">
                Калькулятор первого раунда
            </h2>

            {/* Переключатели */}
            <div className="flex items-center justify-between">
                <Label>Кракен в игре</Label>
                <Switch checked={krakenEnabled} onCheckedChange={setKrakenEnabled} />
            </div>

            <div className="flex items-center justify-between">
                <Label>Белый кит в игре <span className="text-xs text-muted-foreground">(не реализовано)</span></Label>
                <Switch disabled={true}
                    checked={whiteWhaleEnabled}
                    onCheckedChange={setWhiteWhaleEnabled}
                />
            </div>

            {/* Количество игроков */}
            <div className="space-y-2">
                <Label>Количество игроков: {numberOfPlayers}</Label>
                <Slider
                    min={2}
                    max={8}
                    step={1}
                    value={[numberOfPlayers]}
                    onValueChange={([v]) => setNumberOfPlayers(v)}
                />
            </div>

            {/* Порядок хода */}
            <div className="space-y-2">
                <Label>Порядок хода: {turnOrder}</Label>
                <Slider
                    min={1}
                    max={numberOfPlayers}
                    step={1}
                    value={[turnOrder]}
                    onValueChange={([v]) => setTurnOrder(v)}
                />
            </div>

            {/* Выбор карты */}
            <div className="space-y-2">
                <Label>Ваша карта</Label>
                <Select
                    value={selectedType ?? undefined}
                    onValueChange={(v) => setSelectedType(v as Suit | Special)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Выберите карту" />
                    </SelectTrigger>
                    <SelectContent>
                        <div className="px-2 py-1 text-sm text-muted-foreground">
                            Масти
                        </div>
                        {suitValues.map((suit) => (
                            <SelectItem key={suit} value={suit}>
                                {suitLabels[suit]}
                            </SelectItem>
                        ))}

                        <div className="px-2 py-1 text-sm text-muted-foreground">
                            Специальные
                        </div>
                        {availableSpecials.map((special) => (
                            <SelectItem key={special} value={special}>
                                {specialLabels[special]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Значение масти */}
            {selectedType && suitValues.includes(selectedType as Suit) && (
                <div className="space-y-2">
                    <Label>Номинал карты: {suitValue}</Label>
                    <Slider
                        min={1}
                        max={14}
                        step={1}
                        value={[suitValue]}
                        onValueChange={([v]) => setSuitValue(v)}
                    />
                </div>
            )}

            {/* Debug */}
            {/* <pre className="rounded bg-muted p-3 text-sm">
                {JSON.stringify(card, null, 2)}
            </pre> */}

            <h3 className="text-xl font-semibold">При заявке 1</h3>
            <div className="space-y-2">
                <Label>Мат. ожидание очков: <pre>{probabilities1?.reduce((acc, { probability, points }) => acc + probability * points, 0).toFixed(2)}</pre></Label>
            </div>

            {probabilities1 !== null && (
                probabilities1
                    .toSorted((a, b) => b.points - a.points)
                    .map(({ probability, points }, index) => (
                        <div key={index} className="space-y-2">
                            <Label>С вероятностью <pre>{`${(probability * 100).toFixed(2)}%`}</pre> получите очков: <pre>{points}</pre></Label>
                        </div>
                    ))
            )}
            <div className="space-y-2 text-muted-foreground">
                <Label>Сумма вероятностей для контроля: <pre>{probabilities1?.reduce((acc, { probability }) => acc + probability * 100, 0).toFixed(2)}%</pre></Label>
            </div>

        </div>
    );
}
