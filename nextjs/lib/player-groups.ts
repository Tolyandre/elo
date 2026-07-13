import { Club, Match, Player, Tournament } from "@/app/api";

/** Synthetic ID representing players not in any club. Never sent to the backend. */
export const NO_CLUB_ID = "__no_club__";
export const NO_CLUB_LABEL = "Без клуба";
export const RECENT_LABEL = "Недавние";
export const OTHER_TAB_LABEL = "Другие";

type Group = {
  heading: string;
  options: { value: string; label: string }[];
};

/** A tab in the player picker: "Недавние", one per the current user's clubs, then "Другие". */
export type PlayerTab = {
  key: string;
  label: string;
  /** Set for club tabs so the trigger can render the club icon. */
  club?: Club;
  sections: Group[];
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

  const optionsFromIds = (ids: string[]) =>
    ids
      .map((pid) => byId.get(pid))
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
  const isMyClub = (club: Club) => myPlayerId != null && club.players.includes(myPlayerId);
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
  const clubPlayerIds = new Set(clubs.flatMap((c) => c.players));
  const noClub = players
    .filter((p) => !clubPlayerIds.has(p.id))
    .sort((a, b) => byName(playerDisplayName(a), playerDisplayName(b)))
    .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

  if (noClub.length > 0) {
    groups.push({ heading: NO_CLUB_LABEL, options: noClub });
  }

  return groups;
}

/**
 * Ids for the "Недавние" list: the current player first, then the last `limit`
 * distinct players they've played with (most recent match first). The current
 * player is always included once they have at least one match of their own —
 * they trivially qualify as "recent". Empty when there is no current player or
 * no matches of theirs, in which case the caller omits the "Недавние" tab.
 */
export function recentCoPlayerIds(
  matches: Pick<Match, "date" | "score">[] | undefined,
  myPlayerId: string | undefined,
  limit = 10,
): string[] {
  if (!myPlayerId || !matches) return [];
  const myMatches = [...matches]
    .filter((m) => Object.keys(m.score).includes(myPlayerId))
    .sort((a, b) => (a.date === b.date ? 0 : new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()));
  if (myMatches.length === 0) return [];

  const coPlayers: string[] = [];
  const seen = new Set<string>([myPlayerId]);
  for (const m of myMatches) {
    for (const pid of Object.keys(m.score)) {
      if (!seen.has(pid)) {
        seen.add(pid);
        coPlayers.push(pid);
      }
    }
    if (coPlayers.length >= limit) break;
  }
  // Current user first, then their most recent distinct co-players.
  return [myPlayerId, ...coPlayers.slice(0, limit)];
}

/**
 * Builds the tabbed player picker structure:
 * 1. "Недавние" — recent co-players (omitted when empty)
 * 2. one tab per active+checked tournament
 * 3. one tab per club the current user's player belongs to
 * 4. "Другие" — a section per remaining club, then a club-less section
 */
export function buildPlayerTabs(
  players: Pick<Player, "id" | "name" | "geologist_name">[],
  clubs: Club[],
  recentPlayerIds: string[],
  playerDisplayName: (player: Pick<Player, "name" | "geologist_name">) => string,
  clubDisplayName: (club: Pick<Club, "name" | "geologist_name">) => string,
  myPlayerId?: string,
  tournaments: Pick<Tournament, "id" | "name" | "players">[] = [],
): PlayerTab[] {
  const tabs: PlayerTab[] = [];
  const byId = new Map(players.map((p) => [p.id, p]));

  const optionsFromIds = (ids: string[]) =>
    ids
      .map((pid) => byId.get(pid))
      .filter((p): p is Pick<Player, "id" | "name" | "geologist_name"> => p !== undefined)
      .sort((a, b) => byName(playerDisplayName(a), playerDisplayName(b)))
      .map((p) => ({ value: p.id, label: playerDisplayName(p) }));

  // 1. Recent — preserve recency order (not alphabetical)
  const recentOptions = recentPlayerIds
    .filter((id) => byId.has(id))
    .map((id) => ({ value: id, label: playerDisplayName(byId.get(id)!) }));
  if (recentOptions.length > 0) {
    tabs.push({ key: "recent", label: RECENT_LABEL, sections: [{ heading: "", options: recentOptions }] });
  }

  // 2. Tournament tabs (alphabetical)
  const sortedTournaments = [...tournaments].sort((a, b) => byName(a.name, b.name));
  for (const tournament of sortedTournaments) {
    const options = optionsFromIds(tournament.players);
    if (options.length > 0) {
      tabs.push({ key: `tournament:${tournament.id}`, label: tournament.name, sections: [{ heading: "", options }] });
    }
  }

  // 3. The current user's clubs (alphabetical)
  const isMyClub = (club: Club) => myPlayerId != null && club.players.includes(myPlayerId);
  const myClubs = clubs.filter(isMyClub).sort((a, b) => byName(clubDisplayName(a), clubDisplayName(b)));
  for (const club of myClubs) {
    const options = optionsFromIds(club.players);
    if (options.length > 0) {
      tabs.push({ key: `club:${club.id}`, label: clubDisplayName(club), club, sections: [{ heading: "", options }] });
    }
  }

  // 4. "Другие" — remaining clubs as sections, then club-less players
  const otherSections: Group[] = [];
  const otherClubs = clubs.filter((c) => !isMyClub(c)).sort((a, b) => byName(clubDisplayName(a), clubDisplayName(b)));
  for (const club of otherClubs) {
    const options = optionsFromIds(club.players);
    if (options.length > 0) {
      otherSections.push({ heading: clubDisplayName(club), options });
    }
  }
  const clubPlayerIds = new Set(clubs.flatMap((c) => c.players));
  const noClub = players
    .filter((p) => !clubPlayerIds.has(p.id))
    .sort((a, b) => byName(playerDisplayName(a), playerDisplayName(b)))
    .map((p) => ({ value: p.id, label: playerDisplayName(p) }));
  if (noClub.length > 0) {
    otherSections.push({ heading: NO_CLUB_LABEL, options: noClub });
  }
  if (otherSections.length > 0) {
    tabs.push({ key: "other", label: OTHER_TAB_LABEL, sections: otherSections });
  }

  return tabs;
}
