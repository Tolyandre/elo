import { Club, Player } from "@/app/api";

/** Synthetic ID representing players not in any club. Never sent to the backend. */
export const NO_CLUB_ID = "__no_club__";
export const NO_CLUB_LABEL = "Без клуба";

type Group = {
  heading: string;
  options: { value: string; label: string }[];
};

/**
 * Builds ordered player groups for comboboxes and multi-selects:
 * 1. "Недавние" — recent player IDs (if any)
 * 2. One group per club, sorted alphabetically
 * 3. NO_CLUB_LABEL — players not in any club
 */
export function buildPlayerGroups(
  players: Pick<Player, "id" | "name">[],
  clubs: Club[],
  recentPlayerIds: string[]
): Group[] {
  const groups: Group[] = [];

  const byId = new Map(players.map((p) => [p.id, p]));

  // 1. Recent
  if (recentPlayerIds.length > 0) {
    groups.push({
      heading: "Недавние",
      options: recentPlayerIds
        .filter((id) => byId.has(id))
        .map((id) => ({ value: id, label: byId.get(id)!.name })),
    });
  }

  // 2. Per club (alphabetical)
  const sortedClubs = [...clubs].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  for (const club of sortedClubs) {
    const options = club.players
      .map((pid) => byId.get(String(pid)))
      .filter((p): p is Pick<Player, "id" | "name"> => p !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((p) => ({ value: p.id, label: p.name }));

    if (options.length > 0) {
      groups.push({ heading: club.name, options });
    }
  }

  // 3. No club
  const clubPlayerIds = new Set(clubs.flatMap((c) => c.players.map(String)));
  const noClub = players
    .filter((p) => !clubPlayerIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((p) => ({ value: p.id, label: p.name }));

  if (noClub.length > 0) {
    groups.push({ heading: NO_CLUB_LABEL, options: noClub });
  }

  return groups;
}
