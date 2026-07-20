"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GameState, RoundEntry } from "./scoring";

export function BidButtons({
    roundNumber,
    selected,
    onSelect,
    compact = false,
    disabled = false,
}: {
    roundNumber: number;
    selected: number | null;
    onSelect: (n: number) => void;
    compact?: boolean;
    disabled?: boolean;
}) {
    return (
        <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2 md:gap-3"}`}>
            {Array.from({ length: roundNumber + 1 }, (_, i) => (
                <Button
                    key={i}
                    variant={selected === i ? "default" : "outline"}
                    size={compact ? "default" : "lg"}
                    disabled={disabled}
                    className={compact
                        ? "h-10 min-w-10 md:h-12 md:min-w-12 md:text-lg lg:h-14 lg:min-w-14 lg:text-xl"
                        : "w-14 h-14 text-xl md:w-16 md:h-16 md:text-2xl lg:w-20 lg:h-20 lg:text-3xl"
                    }
                    onClick={() => onSelect(i)}
                >
                    {i}
                </Button>
            ))}
        </div>
    );
}

/**
 * Modal editor for one Skull King round/player cell (bid / actual / bonus).
 * In history read-only mode the parent passes `readOnly`, which replaces the
 * editable controls with a static view of the stored entry.
 */
export function EditCellDialog({
    open,
    onClose,
    roundIndex,
    playerIndex,
    state,
    onSave,
    readOnly = false,
}: {
    open: boolean;
    onClose: () => void;
    roundIndex: number;
    playerIndex: number;
    state: GameState;
    onSave: (roundIndex: number, playerIndex: number, entry: RoundEntry) => void;
    readOnly?: boolean;
}) {
    const roundNumber = roundIndex + 1;
    const playerName = state.players[playerIndex]?.name ?? "";
    const original = state.rounds[roundIndex]?.[playerIndex] ?? { bid: 0, actual: null, bonus: 0 };

    const [bid, setBid] = useState(original.bid);
    const [actual, setActual] = useState<number | null>(original.actual ?? null);
    const [bonus, setBonus] = useState(original.bonus);

    // Reset on open
    React.useEffect(() => {
        if (open) {
            /* eslint-disable react-hooks/set-state-in-effect -- sync dialog fields from props when it opens */
            setBid(original.bid);
            setActual(original.actual ?? null);
            setBonus(original.bonus);
            /* eslint-enable react-hooks/set-state-in-effect */
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, roundIndex, playerIndex]);

    const bonusApplicable = actual !== null && actual === bid;

    function handleSave() {
        onSave(roundIndex, playerIndex, {
            bid,
            actual,
            bonus: bonusApplicable ? bonus : 0,
        });
        onClose();
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Раунд {roundNumber} — {playerName}
                    </DialogTitle>
                </DialogHeader>
                {readOnly ? (
                    <div className="space-y-2 py-2 text-center">
                        <div className="text-sm text-muted-foreground">План / Факт</div>
                        <div className="text-2xl font-semibold tabular-nums">
                            {original.bid} / {original.actual ?? "—"}
                        </div>
                        {original.bonus > 0 && (
                            <div className="text-sm text-muted-foreground">Бонус: +{original.bonus}</div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-medium mb-2">План (взяток):</p>
                            <BidButtons roundNumber={roundNumber} selected={bid} onSelect={setBid} compact />
                        </div>
                        <div>
                            <p className="text-sm font-medium mb-2">Факт (взяток):</p>
                            <BidButtons
                                roundNumber={roundNumber}
                                selected={actual}
                                onSelect={(i) => { setActual(i); if (i !== bid) setBonus(0); }}
                                compact
                            />
                        </div>
                        {bonusApplicable && (
                            <div>
                                <p className="text-sm font-medium mb-2">Бонус: <span className="text-xl md:text-2xl font-semibold">{bonus}</span></p>
                                <div className="flex flex-wrap gap-2">
                                    {[10, 20, 30, 40].map((b) => (
                                        <Button key={b} variant="outline" className="md:h-12 md:min-w-[3.5rem] md:text-base lg:h-14 lg:min-w-[4rem] lg:text-lg" onClick={() => setBonus((v) => v + b)}>
                                            +{b}
                                        </Button>
                                    ))}
                                    <Button variant="ghost" className="md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={() => setBonus(0)}>
                                        Сбросить
                                    </Button>
                                </div>
                            </div>
                        )}
                        <Button className="w-full md:h-12 md:text-base lg:h-14 lg:text-lg" onClick={handleSave}>Сохранить</Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
