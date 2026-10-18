"use client";

import { Trophy } from "lucide-react";
import type { Tournament } from "@/app/api";
import { GameImage } from "@/components/game-image";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { trophyById, trophySrc } from "@/lib/trophies";
import { cn } from "@/lib/utils";

/**
 * A tournament's trophy mark: the picked pool art when the tournament has
 * one, the generic cup icon otherwise (including a trophy token whose file
 * left the pool). Shown big next to the winner of a completed tournament,
 * small as the tournament's mark in lists.
 */
export function TournamentTrophyMark({
    tournament,
    className,
}: {
    tournament: Pick<Tournament, "trophy">;
    className?: string;
}) {
    const trophy = tournament.trophy != null ? trophyById(tournament.trophy) : undefined;
    if (trophy == null) {
        return <Trophy className={cn("shrink-0", className)} />;
    }
    return <GameImage src={trophySrc(trophy)} alt="" className={cn("rounded-full", className)} />;
}

/**
 * The champion-banner cup: the mark as a button that opens the pool art in
 * a dialog, uncropped and as large as the viewport allows. The generic cup
 * icon has nothing to enlarge, so it stays a plain mark there.
 */
export function TournamentTrophyZoom({
    tournament,
    className,
}: {
    tournament: Pick<Tournament, "trophy">;
    className?: string;
}) {
    const trophy = tournament.trophy != null ? trophyById(tournament.trophy) : undefined;
    if (trophy == null) {
        return <TournamentTrophyMark tournament={tournament} className={className} />;
    }
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-fit cursor-zoom-in rounded-full p-0.5"
                    aria-label={`Кубок: ${trophy.key} — показать целиком`}
                    title="Показать кубок целиком"
                >
                    <TournamentTrophyMark tournament={tournament} className={className} />
                </Button>
            </DialogTrigger>
            <DialogContent className="w-fit sm:max-w-[90vw]" aria-describedby={undefined}>
                <DialogTitle className="sr-only">Кубок: {trophy.key}</DialogTitle>
                <GameImage
                    src={trophySrc(trophy)}
                    alt={`Кубок: ${trophy.key}`}
                    className="max-h-[80vh] w-auto max-w-full object-contain"
                />
            </DialogContent>
        </Dialog>
    );
}
