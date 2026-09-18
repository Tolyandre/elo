"use client";

import { useState } from "react";
import type { Base58ID } from "@/lib/id";
import { cancelTournamentPromise } from "@/app/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

/**
 * «Отменить турнир» — available to editors from registration and running
 * (ADR-26): a completed tournament cannot be cancelled, the server rejects
 * it with 409.
 */
export function CancelButton({ tournament: t, onDone }: { tournament: { id: Base58ID }; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);

    const confirm = async () => {
        setPending(true);
        try {
            await cancelTournamentPromise(t.id);
            setOpen(false);
            onDone();
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="pt-2 border-t">
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
                Отменить турнир
            </Button>
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title="Отменить турнир?"
                description="Регистрация и сетка закроются навсегда. Матчи остаются в арене турнира."
                confirmText="Отменить турнир"
                confirmVariant="destructive"
                loading={pending}
                onConfirm={confirm}
            />
        </div>
    );
}
