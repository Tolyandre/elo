"use client";

import { useState } from "react";

/**
 * Shared skeleton for the per-kind `<kind>-history` editors (saved-match
 * history mode): holds the parsed game state in useState and funnels every
 * cell edit through setState + onStateChange, with read-only gating in one
 * place. The game-specific parts — the scoring table, the edit dialog and
 * how an edit is applied to the state — come in as props from the thin
 * per-kind wrapper (see skull-king-history.tsx / iaww-history.tsx).
 */
export function CalculatorHistory<GameState, EditTarget>({
    storage,
    readOnly,
    onStateChange,
    fromStorage,
    applyEdit,
    table,
    dialog,
}: {
    storage: Record<string, unknown>;
    readOnly: boolean;
    onStateChange: (state: unknown) => void;
    fromStorage: (storage: Record<string, unknown>) => GameState;
    /** Returns the next state with the edited cell applied (pure). */
    applyEdit: (state: GameState, target: EditTarget, value: unknown) => GameState;
    /** The scoring table; `requestEdit` is a no-op while readOnly. */
    table: (state: GameState, requestEdit: (target: EditTarget) => void) => React.ReactNode;
    /** The cell editor; `target` is null while no cell is being edited. */
    dialog: (props: {
        state: GameState;
        target: EditTarget | null;
        save: (target: EditTarget, value: unknown) => void;
        close: () => void;
        readOnly: boolean;
    }) => React.ReactNode;
}) {
    const [state, setState] = useState<GameState>(() => fromStorage(storage));
    const [target, setTarget] = useState<EditTarget | null>(null);

    function save(editTarget: EditTarget, value: unknown) {
        const next = applyEdit(state, editTarget, value);
        setState(next);
        onStateChange(next);
    }

    return (
        <>
            {table(state, readOnly ? () => {} : setTarget)}
            {dialog({ state, target, save, close: () => setTarget(null), readOnly })}
        </>
    );
}
