"use client";

/**
 * Shared confirm/rename dialog + action hook, replacing the copy-pasted
 * `deleteTarget`/`deleting`/`setOpen`/`confirmDelete` state machines that were
 * hand-rolled across the admin and tournament pages.
 */
import * as React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Matches the `variant` keys of the Button component. */
type ButtonVariant =
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";

type CommonProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    loading?: boolean;
    /** Button variant for the confirm action (e.g. "destructive" for deletes). */
    confirmVariant?: ButtonVariant;
};

function ConfirmDialogBase({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "Подтвердить",
    cancelText = "Отмена",
    loading = false,
    confirmVariant = "default",
    onConfirm,
    children,
}: CommonProps & {
    onConfirm: () => void;
    children?: React.ReactNode;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {children}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        {cancelText}
                    </Button>
                    <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>
                        {loading ? `${confirmText}...` : confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** A simple confirm dialog (no extra content beyond the description). */
export function ConfirmDialog(props: CommonProps & { onConfirm: () => void }) {
    return <ConfirmDialogBase {...props} />;
}

/** A confirm dialog with arbitrary extra content (e.g. a rename input). */
export function ConfirmDialogWithContent(
    props: CommonProps & { onConfirm: () => void; children: React.ReactNode },
) {
    return <ConfirmDialogBase {...props} />;
}

/**
 * State machine for a one-shot async action gated behind a confirm dialog.
 * `trigger(target)` opens the dialog remembering `target`; `confirm()` runs the
 * action, disabling the button while pending. The action is responsible for
 * closing the dialog on success (call `reset()`) — toasts are shown by the API layer.
 *
 * @example
 * const del = useConfirmAction(async (g: Game) => { await deleteGamePromise(g.id); invalidate(); });
 * // <Button onClick={() => del.trigger(game)}>Delete</Button>
 * // <ConfirmDialog open={del.open} onOpenChange={del.onOpenChange}
 * //   title="Удалить" description={...} confirmVariant="destructive"
 * //   confirmText="Удалить" loading={del.pending} onConfirm={del.confirm} />
 */
export function useConfirmAction<T>(
    action: (target: T) => Promise<void>,
): {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: T | null;
    pending: boolean;
    trigger: (target: T) => void;
    confirm: () => void;
    reset: () => void;
} {
    const [target, setTarget] = React.useState<T | null>(null);
    const [pending, setPending] = React.useState(false);

    const actionRef = React.useRef(action);
    React.useEffect(() => {
        actionRef.current = action;
    });

    const trigger = React.useCallback((t: T) => {
        setTarget(t);
    }, []);

    const onOpenChange = React.useCallback((open: boolean) => {
        if (!open) setTarget(null);
    }, []);

    const confirm = React.useCallback(() => {
        if (target === null || pending) return;
        const t = target;
        setPending(true);
        actionRef
            .current(t)
            .catch(() => {
                // toasts are shown by the API layer
            })
            .finally(() => setPending(false));
    }, [target, pending]);

    const reset = React.useCallback(() => setTarget(null), []);

    return {
        open: target !== null,
        onOpenChange,
        target,
        pending,
        trigger,
        confirm,
        reset,
    };
}
