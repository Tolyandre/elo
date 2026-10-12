"use client";

import { useMemo, useState } from "react";
import { availableTrophies, trophyById, trophySrc } from "@/lib/trophies";
import { useTournaments } from "@/app/tournaments/tournamentsContext";
import { GameImage } from "@/components/game-image";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The tournament trophy picker (ADR-26 §UI): the static art pool minus the
 * trophies other tournaments hold. The holder's own pick stays visible.
 * Images only — a trophy is identified by its file, not by a display name
 * (see the help hint on the form for how to add one).
 */
export function TrophyPicker({
    tournamentId,
    value,
    onChange,
}: {
    tournamentId: string;
    value?: string | null;
    onChange: (trophy: string | null) => void;
}) {
    const { tournaments } = useTournaments();
    // `search` is intentionally absent: the pool is a handful of images
    // without display names, there is nothing to search by.
    const [open, setOpen] = useState(false);

    const current = value != null ? trophyById(value) : undefined;
    const pool = useMemo(() => availableTrophies(tournaments, tournamentId), [tournaments, tournamentId]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-auto w-fit justify-start p-1.5"
                    aria-expanded={open}
                    aria-label={current ? `Кубок: ${current.key}` : "Выбрать кубок"}
                >
                    {current ? (
                        <GameImage src={trophySrc(current)} alt="" className="size-12 shrink-0 rounded-full" />
                    ) : (
                        <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                            нет
                        </span>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle>Кубок турнира</DialogTitle>
                </DialogHeader>

                <div className="flex flex-wrap gap-2">
                    {pool.map((trophy) => (
                        <button
                            key={trophy.key}
                            type="button"
                            onClick={() => {
                                onChange(trophy.key);
                                setOpen(false);
                            }}
                            className={`inline-flex rounded-full border-2 p-0.5 transition-colors hover:border-primary ${
                                trophy.key === value ? "border-primary" : "border-transparent"
                            }`}
                            aria-pressed={trophy.key === value}
                            aria-label={`Кубок: ${trophy.key}`}
                            title={trophy.key}
                        >
                            <GameImage src={trophySrc(trophy)} alt="" className="size-24 shrink-0 rounded-full" />
                        </button>
                    ))}
                </div>
                {pool.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Свободных кубков пока нет — все уже заняты турнирами.
                    </p>
                )}

                <div className="flex justify-between">
                    {value != null ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        >
                            Убрать кубок
                        </Button>
                    ) : (
                        <span />
                    )}
                    <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                        Закрыть
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
