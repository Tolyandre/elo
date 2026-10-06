"use client";

import { useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Overwrite-conflict flow shared by the live table game views: a cell can
 * change between opening the edit dialog and saving (someone else's edit
 * landed via SSE). The hook records the value the user saw when the dialog
 * opened, re-checks it on save, and — when the cell moved underneath — lets
 * the user decide whose value wins instead of silently overwriting. Pair the
 * hook with <CellConflictDialog> rendered next to the view.
 */
export function useCellConflict<Target, Value>({
    readCurrent,
    isEqual,
    apply,
}: {
    /** Live value of the cell a save is about to land on. */
    readCurrent: (target: Target) => Value | null;
    isEqual: (a: Value | null, b: Value | null) => boolean;
    /** Applies the user's value (host patch or player submit). */
    apply: (target: Target, value: Value) => void;
}) {
    // The value the cell had when the edit dialog opened (null = empty).
    const [seen, setSeen] = useState<Value | null>(null);
    const [pending, setPending] = useState<{
        target: Target;
        value: Value;
        seen: Value | null;
        current: Value | null;
    } | null>(null);

    return {
        /** Call when the edit dialog opens for a cell. */
        markSeen(value: Value | null) {
            setSeen(value);
        },
        /**
         * Call from the edit dialog's save. Applies immediately when nothing
         * changed underneath — or the same value was meanwhile saved by
         * someone else; otherwise raises the conflict dialog.
         */
        save(target: Target, value: Value) {
            const current = readCurrent(target);
            if (isEqual(seen, current) || isEqual(value, current)) {
                apply(target, value);
                return;
            }
            setPending({ target, value, seen, current });
        },
        pending,
        /** Resolve the conflict: true = save the user's value anyway. */
        settle(applyChoice: boolean) {
            if (pending && applyChoice) apply(pending.target, pending.value);
            setPending(null);
        },
    };
}

/** The counterpart dialog for `useCellConflict().pending`. */
export function CellConflictDialog<Value>({
    pending,
    format,
    onSettle,
}: {
    pending: { value: Value; seen: Value | null; current: Value | null } | null;
    format: (value: Value | null) => string;
    onSettle: (apply: boolean) => void;
}) {
    return (
        <AlertDialog
            open={!!pending}
            onOpenChange={(open) => {
                if (!open && pending) onSettle(false);
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Ячейку уже изменили</AlertDialogTitle>
                    <AlertDialogDescription>
                        Пока вы редактировали, значение изменилось: было «{format(pending?.seen ?? null)}»,
                        стало «{format(pending?.current ?? null)}».
                        Сохранить ваше «{format(pending?.value ?? null)}»?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => onSettle(false)}>
                        Оставить новое
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => onSettle(true)}>
                        Сохранить моё
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
