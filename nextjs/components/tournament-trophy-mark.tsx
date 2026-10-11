"use client";

import { Trophy } from "lucide-react";
import type { Tournament } from "@/app/api";
import { GameImage } from "@/components/game-image";
import { trophyById } from "@/lib/trophies";
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
    return <GameImage src={trophy.src} alt="" className={cn("rounded-full", className)} />;
}
