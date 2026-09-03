"use client";

import { useState } from "react";
import { BidButtons } from "@/components/calculators/skull-king";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Result entry for one player: taken tricks + bonus (only applicable when the
 * plan is met). State is local so switching players mid-entry loses nothing
 * already submitted.
 */
export function ResultEntryCard({
    player,
    roundNumber,
    bid,
    initialActual = null,
    initialBonus = 0,
    onSubmit,
    disabled = false,
}: {
    player: { id: string; name: string };
    roundNumber: number;
    bid: number;
    initialActual?: number | null;
    initialBonus?: number;
    onSubmit: (actual: number, bonus: number) => void;
    disabled?: boolean;
}) {
    const [actual, setActual] = useState<number | null>(initialActual);
    const [bonus, setBonus] = useState(initialBonus);

    // Bonus is applicable whenever plan is exactly met
    const bonusApplicable = actual !== null && actual === bid;

    function handleActualSelect(n: number) {
        const willHaveBonus = n === bid;
        setActual(n);
        setBonus(0);
        if (!willHaveBonus) {
            // No bonus to enter — advance immediately
            onSubmit(n, 0);
        }
    }

    function handleNext() {
        if (actual === null) return;
        onSubmit(actual, bonus);
    }

    return (
        <div className="space-y-4">
            <div>
                <p className="text-xl md:text-2xl font-semibold">{player.name}</p>
                <p className="text-sm md:text-base text-muted-foreground">
                    план: {bid}
                </p>
            </div>

            <div>
                <p className="text-sm md:text-base font-medium mb-2">Взято взяток:</p>
                <BidButtons
                    roundNumber={roundNumber}
                    selected={actual}
                    onSelect={handleActualSelect}
                    disabled={disabled}
                />
                {disabled && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Сохранение...
                    </p>
                )}
            </div>

            {bonusApplicable && (
                <>
                    <div>
                        <p className="text-sm md:text-base font-medium mb-2">
                            Бонус: <span className="text-xl md:text-2xl font-semibold">{bonus}</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {[10, 20, 30, 40].map((b) => (
                                <Button
                                    key={b}
                                    variant="outline"
                                    disabled={disabled}
                                    className="md:h-12 md:min-w-[3.5rem] md:text-base lg:h-14 lg:min-w-[4rem] lg:text-lg"
                                    onClick={() => setBonus((v) => v + b)}
                                >
                                    +{b}
                                </Button>
                            ))}
                            <Button variant="ghost" disabled={disabled} className="md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={() => setBonus(0)}>
                                Сбросить
                            </Button>
                        </div>
                    </div>

                    <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" disabled={disabled} onClick={handleNext}>
                        {disabled ? <Loader2 className="h-5 w-5 animate-spin" /> : "Дальше"}
                    </Button>
                </>
            )}
        </div>
    );
}
