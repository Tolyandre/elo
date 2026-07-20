"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VictoryPoints } from "./victory-points";
import { ScoringBadge } from "./scoring-badge";
import { ROWS } from "./scoring";
import type { CellValue, EditTarget, GameState } from "./scoring";

/**
 * Modal number entry for one direct-VP or multiplier cell. Pure controlled
 * component — caller owns the GameState and decides what to do on save.
 *
 * In history read-only mode the parent passes `readOnly`, which hides the
 * Clear/Save buttons so the dialog becomes view-only.
 */
export function EditDialog({
    target,
    state,
    onClose,
    onSave,
    readOnly = false,
}: {
    target: EditTarget | null;
    state: GameState;
    onClose: () => void;
    onSave: (target: EditTarget, value: number | CellValue) => void;
    readOnly?: boolean;
}) {
    const row = target?.kind === "multiplier" ? ROWS.find(r => r.id === target.rowId) : null;
    const player = target ? state.players.find(p => p.id === target.playerId) : null;

    const currentDirect = target?.kind === "direct" ? (state.directVP[target.playerId] || 0) : 0;
    const currentCell = target?.kind === "multiplier"
        ? state.multipliers[target.rowId]?.[target.playerId]
        : undefined;

    const [directVal, setDirectVal] = useState(String(currentDirect || ""));
    const [coeff, setCoeff] = useState(String(currentCell?.coeff || ""));
    const [count, setCount] = useState(String(currentCell?.count || ""));

    React.useEffect(() => {
        if (!target) return;
        /* eslint-disable react-hooks/set-state-in-effect -- sync the edit inputs from the selected target */
        if (target.kind === "direct") {
            const v = state.directVP[target.playerId] || 0;
            setDirectVal(v ? String(v) : "");
        } else {
            const c = state.multipliers[target.rowId]?.[target.playerId];
            setCoeff(c?.coeff ? String(c.coeff) : "");
            setCount(c?.count ? String(c.count) : "");
        }
        /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    if (!target || !player) return null;

    const isDirect = target.kind === "direct";
    const isPair = row?.kind === "pair";
    const canSave = isDirect
        ? directVal !== "" && parseInt(directVal) > 0
        : isPair
            ? count !== "" && parseInt(count) > 0
            : coeff !== "" && count !== "" && parseInt(coeff) > 0 && parseInt(count) > 0;

    function onlyDigits(e: React.KeyboardEvent) {
        if (e.key === "Enter") { handleSave(); return; }
        if (e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault();
    }

    function handleSave() {
        if (!target) return;
        if (isDirect) {
            onSave(target, parseInt(directVal) || 0);
        } else if (isPair && row?.kind === "pair") {
            onSave(target, { coeff: row.coeff, count: parseInt(count) || 0 });
        } else {
            onSave(target, { coeff: parseInt(coeff) || 0, count: parseInt(count) || 0 });
        }
        onClose();
    }

    function handleClear() {
        if (!target) return;
        if (isDirect) {
            onSave(target, 0);
        } else {
            onSave(target, { coeff: 0, count: 0 });
        }
        onClose();
    }

    return (
        <Dialog open={!!target} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-xs">
                <DialogHeader>
                    <DialogTitle>{player.name}</DialogTitle>
                </DialogHeader>

                {/* Row icon(s) */}
                <div className="flex items-center justify-center gap-2 py-1">
                    {isDirect
                        ? <VictoryPoints hideValue />
                        : row?.kind === "pair"
                            ? <ScoringBadge vp={row.coeff} icon={row.icon} icon2={row.icon2} />
                            : row?.kind === "single"
                                ? row.icon
                                : null
                    }
                </div>

                {readOnly ? (
                    <div className="text-center text-2xl py-2">
                        {isDirect
                            ? (currentDirect || 0)
                            : currentCell
                                ? <span>{currentCell.coeff}×{currentCell.count} <span className="text-muted-foreground">= {currentCell.coeff * currentCell.count}</span></span>
                                : <span className="text-muted-foreground">—</span>}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {isDirect ? (
                            <div>
                                <label className="text-sm font-medium block mb-1">Победные очки</label>
                                <input
                                    type="number" min="0" autoFocus
                                    value={directVal}
                                    onChange={e => setDirectVal(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={onlyDigits}
                                    className="w-full border rounded px-3 py-2 text-xl text-center bg-background"
                                    inputMode="numeric"
                                />
                            </div>
                        ) : isPair ? (
                            <div>
                                <label className="text-sm font-medium block mb-1">Количество сетов</label>
                                <input
                                    type="number" min="0" autoFocus
                                    value={count}
                                    onChange={e => setCount(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={onlyDigits}
                                    className="w-full border rounded px-3 py-2 text-xl text-center bg-background"
                                    inputMode="numeric"
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium block mb-1">ПО за сет</label>
                                    <input
                                        type="number" min="0" autoFocus
                                        value={coeff}
                                        onChange={e => setCoeff(e.target.value.replace(/\D/g, ""))}
                                        onKeyDown={onlyDigits}
                                        className="w-full border rounded px-2 py-2 text-xl text-center bg-background"
                                        inputMode="numeric"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium block mb-1">Кол-во сетов</label>
                                    <input
                                        type="number" min="0"
                                        value={count}
                                        onChange={e => setCount(e.target.value.replace(/\D/g, ""))}
                                        onKeyDown={onlyDigits}
                                        className="w-full border rounded px-2 py-2 text-xl text-center bg-background"
                                        inputMode="numeric"
                                    />
                                </div>
                            </div>
                        )}


                        <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={handleClear}>
                                Очистить
                            </Button>
                            <Button className="flex-1" onClick={handleSave} disabled={!canSave}>
                                Сохранить
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
