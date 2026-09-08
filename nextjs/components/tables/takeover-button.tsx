"use client";

import { useState } from "react";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
    busy: boolean;
    onConfirm: () => Promise<void>;
};

/**
 * "Стать ведущим" with a confirmation. Claims hosting of the table (edit
 * permission checked server-side); if another user hosted the table, their
 * page steps down to a participant automatically.
 */
export function TakeoverButton({ busy, onConfirm }: Props) {
    const [open, setOpen] = useState(false);

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Стать ведущим"}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Стать ведущим?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Вы возьмёте управление столом на себя. Если сейчас у стола другой
                        ведущий, его страница переключится в режим игрока.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={busy}
                        onClick={(e) => {
                            e.preventDefault();
                            onConfirm().finally(() => setOpen(false));
                        }}
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Стать ведущим"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
