"use client";

import * as React from "react";
import { Player } from "@/app/api";
import { useClubs } from "@/app/clubsContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { ClubIcon } from "@/components/club-icon";
import { cn } from "@/lib/utils";

/**
 * Renders the icons of every club a player belongs to (0..n), in club-name order.
 * Drop it directly before an existing player-name node when the surrounding markup is
 * bespoke. Renders nothing when the player is in no club (or has an offline temp id).
 */
export function ClubIcons({ playerId, className }: { playerId: string; className?: string }) {
  const { clubsForPlayer } = useClubs();
  const clubs = clubsForPlayer(playerId).filter((c) => c.icon_svg);
  if (clubs.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 shrink-0", className)}>
      {clubs.map((club) => (
        <ClubIcon key={club.id} club={club} />
      ))}
    </span>
  );
}

/**
 * Convenience: club icons + display name, with optional "this is me" highlight.
 * Use at simple call sites; sites with custom layout can use <ClubIcons> on its own.
 */
export function PlayerName({
  player,
  me = false,
  className,
}: {
  player: Pick<Player, "id" | "name" | "geologist_name">;
  me?: boolean;
  className?: string;
}) {
  const { playerDisplayName } = usePlayers();
  const name = playerDisplayName(player);
  return (
    <span className={cn("inline-flex items-center gap-1 min-w-0", className)}>
      <ClubIcons playerId={player.id} />
      {me ? (
        <span className="truncate bg-blue-100 dark:bg-blue-900/40 rounded px-1">{name}</span>
      ) : (
        <span className="truncate">{name}</span>
      )}
    </span>
  );
}
