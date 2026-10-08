"use client";

import { useCallback } from "react";
import type { AuditEntityType } from "@/app/api";
import { useClubs } from "@/app/clubsContext";
import { useTenants } from "@/app/tenantsContext";
import { useGames } from "@/app/gamesContext";
import { usePlayers } from "@/app/players/PlayersContext";
import { useTags } from "@/app/tagsContext";
import { useTournaments } from "@/app/tournaments/tournamentsContext";

/**
 * Resolves an audit row's entity_id to the entity's current display name via
 * the app-wide context providers (all mounted in the root layout), so every
 * historical row — including ones written before names were captured — shows
 * what the entity is called now. Returns undefined when the name cannot be
 * resolved client-side (the entity was deleted, or the type has no app-wide
 * list: match rows have no name at all, arenas/users are not kept in a
 * context) — the row falls back to the plain entity id.
 */
export function useAuditEntityName(): (entityType: AuditEntityType, entityId: string) => string | undefined {
    const { clubs } = useClubs();
    const { tenants } = useTenants();
    const { games } = useGames();
    const { players, playerDisplayName } = usePlayers();
    const { tags } = useTags();
    const { tournaments } = useTournaments();

    return useCallback(
        (entityType, entityId) => {
            switch (entityType) {
                case "club":
                    return clubs.find((c) => c.id === entityId)?.name;
                case "tenant":
                    return tenants.find((t) => t.id === entityId)?.name;
                case "game":
                    return games.find((g) => g.id === entityId)?.name;
                case "player": {
                    const player = players.find((p) => p.id === entityId);
                    return player && playerDisplayName(player);
                }
                case "tag":
                    return tags.find((t) => t.id === entityId)?.name;
                case "tournament":
                    return tournaments.find((t) => t.id === entityId)?.name;
                default:
                    // match: no name exists; arena/user: no app-wide list.
                    return undefined;
            }
        },
        [clubs, tenants, games, players, playerDisplayName, tags, tournaments],
    );
}
