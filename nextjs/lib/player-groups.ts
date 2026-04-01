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
  players: Pick<Player, "id" | "name" | "geologist_name">[],
  clubs: Club[],
  recentPlayerIds: string[],
  playerDisplayName: (player: Pick<Player, "name" | "geologist_name">) => string,
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string
): Group[] {
  const groups: Group[] = [];

  const byId = new Map(players.map((p) => [p.id, p]));

  // 1. Recent
  if (recentPlayerIds.length > 0) {
    groups.push({
      heading: "Недавние",
      options: recentPlayerIds
        .filter((id) => byId.has(id))
        .map((id) => {
          const p = byId.get(id)!;
          return { value: id, label: playerDisplayName(p) };
        }),
    });
  }

  // 2. Per club (alphabetical by display name)
  const sortedClubs = [...clubs].sort((a, b) =>
    clubDisplayName(a).localeCompare(clubDisplayName(b), undefined, { sensitivity: "base" })
  );

  for (const club of sortedClubs) {
    const options = club.players
      .map((pid) => byId.get(String(pid)))
      .filter((p): p is Pick<Player, "id" | "name" | "geologist_name"> => p !== undefined)
      .sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" }))
      .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

    if (options.length > 0) {
      groups.push({ heading: clubDisplayName(club), options });
    }
  }

  // 3. No club
  const clubPlayerIds = new Set(clubs.flatMap((c) => c.players.map(String)));
  const noClub = players
    .filter((p) => !clubPlayerIds.has(p.id))
    .sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b), undefined, { sensitivity: "base" }))
    .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

  if (noClub.length > 0) {
    groups.push({ heading: NO_CLUB_LABEL, options: noClub });
  }

  return groups;
}
