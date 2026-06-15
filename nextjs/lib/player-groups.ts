import { Club, Player, Tournament } from "@/app/api";

/** Synthetic ID representing players not in any club. Never sent to the backend. */
export const NO_CLUB_ID = "__no_club__";
export const NO_CLUB_LABEL = "Без клуба";

type Group = {
  heading: string;
  options: { value: string; label: string }[];
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * Builds ordered player groups for comboboxes and multi-selects:
 * 1. "Недавние" — recent player IDs (if any)
 * 2. One group per active+checked tournament, sorted alphabetically
 * 3. One group per club, sorted alphabetically — but clubs the current user
 *    belongs to come first
 * 4. NO_CLUB_LABEL — players not in any club
 */
export function buildPlayerGroups(
  players: Pick<Player, "id" | "name" | "geologist_name">[],
  clubs: Club[],
  recentPlayerIds: string[],
  playerDisplayName: (player: Pick<Player, "name" | "geologist_name">) => string,
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string,
  tournaments: Pick<Tournament, "name" | "players">[] = [],
  myPlayerId?: string,
): Group[] {
  const groups: Group[] = [];

  const byId = new Map(players.map((p) => [p.id, p]));

  const optionsFromIds = (ids: number[]) =>
    ids
      .map((pid) => byId.get(String(pid)))
      .filter((p): p is Pick<Player, "id" | "name" | "geologist_name"> => p !== undefined)
      .sort((a, b) => byName(playerDisplayName(a), playerDisplayName(b)))
      .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

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

  // 2. Per active+checked tournament (alphabetical by name)
  const sortedTournaments = [...tournaments].sort((a, b) => byName(a.name, b.name));
  for (const tournament of sortedTournaments) {
    const options = optionsFromIds(tournament.players);
    if (options.length > 0) {
      groups.push({ heading: tournament.name, options });
    }
  }

  // 3. Per club (alphabetical by display name), current user's clubs first
  const isMyClub = (club: Club) => myPlayerId != null && club.players.map(String).includes(myPlayerId);
  const sortedClubs = [...clubs].sort((a, b) => {
    const mine = Number(isMyClub(b)) - Number(isMyClub(a));
    return mine !== 0 ? mine : byName(clubDisplayName(a), clubDisplayName(b));
  });

  for (const club of sortedClubs) {
    const options = optionsFromIds(club.players);
    if (options.length > 0) {
      groups.push({ heading: clubDisplayName(club), options });
    }
  }

  // 4. No club
  const clubPlayerIds = new Set(clubs.flatMap((c) => c.players.map(String)));
  const noClub = players
    .filter((p) => !clubPlayerIds.has(p.id))
    .sort((a, b) => byName(playerDisplayName(a), playerDisplayName(b)))
    .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

  if (noClub.length > 0) {
    groups.push({ heading: NO_CLUB_LABEL, options: noClub });
  }

  return groups;
}
