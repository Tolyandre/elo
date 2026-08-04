/**
 * Registry of match-scoring calculators. Each kind ships a typed adapter that
 * the saved-match editor (app/matches/edit) dispatches through, replacing the
 * per-kind `if (kind === "skull-king") else if (kind === "iaww")` branching.
 *
 * The `GameState` for each calculator differs in shape, so at the dispatch seam
 * it is treated as opaque (`CalculatorState`). Each adapter knows how to build
 * the score map and the normalized storage form from its own state, and renders
 * its own history editor component.
 */
import type { ComponentType } from "react";
import { scoreFromState as skScoreFromState } from "@/components/calculators/skull-king";
import { toStorage as skToStorage } from "@/components/calculators/skull-king/storage";
import { scoreFromState as iawwScoreFromState } from "@/components/calculators/iaww/scoring";
import { toStorage as iawwToStorage } from "@/components/calculators/iaww/storage";
import { SkullKingHistory } from "@/app/matches/edit/skull-king-history";
import { IawwHistory } from "@/app/matches/edit/iaww-history";

export type CalculatorKind = "skull-king" | "iaww";

/** Opaque calculator state at the dispatch seam. */
export type CalculatorState = unknown;

export type CalculatorHistoryProps = {
    storage: Record<string, unknown>;
    readOnly: boolean;
    onStateChange: (state: CalculatorState) => void;
};

export interface CalculatorAdapter {
    kind: CalculatorKind;
    /** Title shown in the saved-match calculator editor. */
    editTitle: string;
    /** Build the score map (player id → score) from the in-memory state. */
    scoreFromState: (state: CalculatorState) => Record<string, number>;
    /** Convert the in-memory state into the normalized persisted form. */
    toStorage: (state: CalculatorState) => Record<string, unknown>;
    /** Saved-match editor for this calculator kind. */
    History: ComponentType<CalculatorHistoryProps>;
}

export const CALCULATORS: Record<CalculatorKind, CalculatorAdapter> = {
    "skull-king": {
        kind: "skull-king",
        editTitle: "Skull King — редактирование",
        scoreFromState: (s) => skScoreFromState(s as Parameters<typeof skScoreFromState>[0]),
        toStorage: (s) => skToStorage(s as Parameters<typeof skToStorage>[0]) as Record<string, unknown>,
        History: SkullKingHistory as ComponentType<CalculatorHistoryProps>,
    },
    iaww: {
        kind: "iaww",
        editTitle: "Этот Безумный Мир — редактирование",
        scoreFromState: (s) => iawwScoreFromState(s as Parameters<typeof iawwScoreFromState>[0]),
        toStorage: (s) => iawwToStorage(s as Parameters<typeof iawwToStorage>[0]) as Record<string, unknown>,
        History: IawwHistory as ComponentType<CalculatorHistoryProps>,
    },
};

/** Look up a calculator adapter by kind string; undefined for unknown kinds. */
export function getCalculator(kind: string): CalculatorAdapter | undefined {
    return (CALCULATORS as Record<string, CalculatorAdapter>)[kind];
}

/** Type guard for the known calculator kinds. */
export function isCalculatorKind(kind: string): kind is CalculatorKind {
    return kind in CALCULATORS;
}
