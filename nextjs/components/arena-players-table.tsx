"use client";

import Link from "next/link";
import type { Arena, ArenaPlayer } from "@/app/api";
import { parseArenaSettings } from "@/app/api";
import { RankIcon } from "@/components/rank-icon";
import { ClubIcons } from "@/components/player-name";
import { RankChangeBadge, RatingDiff } from "@/components/rank-change-badge";
import { useSettings } from "@/app/settingsContext";
import { winsNeededForAmateur } from "@/app/eloCalculation";

const LEAGUE_TITLES: Record<string, string> = {
  elite: "Высшая лига",
  amateur: "Любители",
  newbie: "Новички",
};

/** Which historical snapshot the change indicators compare against. */
export type ArenaRankPeriod = "day_ago" | "week_ago";

/**
 * Recomputes display ranks for a filtered subset of arena players (club
 * filter): same rules as the server — leagues in descending promotion order,
 * rating descending within a league, ties sharing a rank.
 */
export function computeDisplayRanks(
  players: ArenaPlayer[],
  leagues: string[],
): Map<string, number | null> {
  const priority = (league: string | null) => {
    if (league == null) return leagues.length;
    const i = leagues.indexOf(league);
    return i === -1 ? leagues.length : leagues.length - 1 - i;
  };
  const ranked = players.filter((p) => p.rank != null);
  const entries = ranked.map((p) => ({ id: p.player_id, league: p.league, rating: p.rating }));
  entries.sort((a, b) => {
    const pd = priority(a.league) - priority(b.league);
    if (pd !== 0) return pd;
    return b.rating - a.rating;
  });

  const map = new Map<string, number | null>();
  let counter = 0;
  let prevRounded: number | null = null;
  let prevLeague: string | null = null;
  let prevRank: number | null = null;
  for (const e of entries) {
    const rounded = Math.round(e.rating);
    if (prevRounded === rounded && prevLeague === e.league && prevRank != null) {
      map.set(e.id, prevRank);
    } else {
      prevRank = counter + 1;
      map.set(e.id, prevRank);
      prevRounded = rounded;
      prevLeague = e.league;
    }
    counter++;
  }
  return map;
}

/**
 * Ranked arena players table (ADR-24): rank icon, club icons, name, rating
 * with the per-period diff and the rank-change badge — styled like the
 * /players page. `ranks` carries display ranks for the current club filter
 * (falls back to the server ranks).
 */
export function ArenaPlayersTable({
  players,
  ranks,
  period,
}: {
  players: ArenaPlayer[];
  ranks?: Map<string, number | null>;
  period?: ArenaRankPeriod;
}) {
  if (players.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет игроков</p>;
  }
  return (
    <table className="table-auto border-collapse w-full text-sm">
      <tbody>
        {players.map((player) => {
          const displayRank = (ranks?.get(player.player_id) ?? player.rank) ?? null;
          const history = player.rank_history ?? null;
          const point = period != null && history ? history[period] : null;
          return (
            <tr key={player.player_id}>
              <td className="px-1 py-2 text-center min-w-7">
                {displayRank != null ? <RankIcon rank={displayRank} /> : null}
              </td>
              <td className="px-1 py-2 min-w-10">
                <RankChangeBadge
                  current={displayRank}
                  previous={point ? point.rank : null}
                />
              </td>
              <td className="px-1 py-2">
                <ClubIcons playerId={player.player_id} className="mr-1 align-text-bottom" />
                <Link href={`/players/view?id=${player.player_id}`} className="hover:underline">
                  {player.name}
                </Link>
                {player.league === "newbie" && player.wins_needed_for_amateur > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ещё ~{player.wins_needed_for_amateur}
                    {player.wins_needed_for_amateur_upper > player.wins_needed_for_amateur
                      ? `–${player.wins_needed_for_amateur_upper}`
                      : ""}{" "}
                    побед
                  </span>
                )}
                {player.league === "amateur" && player.matches_left_for_elite > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ещё {player.matches_left_for_elite} партий
                  </span>
                )}
              </td>
              <td className="px-1 py-2 text-right">
                <RatingDiff
                  current={player.rating}
                  previous={point ? point.rating : null}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Players grouped by league in descending promotion order — elite on top, then
 * amateur, then newbie — matching the /players page (the settings list is in
 * promotion order, so it renders reversed). A league-less arena renders one
 * table without headers. Each league keeps its promotion description footer.
 */
export function ArenaPlayersGroups({
  players,
  arena,
  ranks,
  period,
}: {
  players: ArenaPlayer[];
  arena: Arena;
  ranks?: Map<string, number | null>;
  period?: ArenaRankPeriod;
}) {
  const { leagues } = parseArenaSettings(arena.settings);
  if (leagues.length === 0) {
    return <ArenaPlayersTable players={players} ranks={ranks} period={period} />;
  }
  return (
    <>
      {[...leagues].reverse().map((league) => {
        const leaguePlayers = players.filter((p) => p.league === league.kind);
        return (
          <div key={league.kind}>
            <h2 className="text-xl font-semibold mb-2 mt-4">
              {LEAGUE_TITLES[league.kind] ?? league.kind}
            </h2>
            <ArenaPlayersTable
              players={leaguePlayers}
              ranks={ranks}
              period={period}
            />
            <LeagueFooter kind={league.kind} arena={arena} />
          </div>
        );
      })}
    </>
  );
}

function LeagueFooter({ kind, arena }: { kind: string; arena: Arena }) {
  const { startingElo, eloConstK, eloConstD } = useSettings();
  const { starting_rating: startingRating, leagues } = parseArenaSettings(arena.settings);
  const newbie = leagues.find((l) => l.kind === "newbie");
  const elite = leagues.find((l) => l.kind === "elite");

  if (kind === "elite" && elite) {
    return (
      <p className="text-xs text-muted-foreground mb-2">
        Для Высшей Лиги нужно {elite.matches_6m} партий за последние 6 месяцев, среди них{" "}
        {elite.matches_2m} за последние 2 месяца
      </p>
    );
  }
  if (kind === "amateur" && newbie) {
    // The catch-up description only makes sense when the arena actually has
    // the newbie league below (with starting rating = starting elo there is
    // no gap to close). The schema requires these params on a newbie league.
    const [lower, upper] = winsNeededForAmateur(
      startingElo - startingRating,
      newbie.goal_gap ?? 0,
      eloConstK,
      newbie.earned_max ?? 0,
      newbie.tau ?? 1,
      eloConstD,
    );
    return (
      <p className="text-xs text-muted-foreground mb-2">
        Для Лиги Любителей нужно совпадение рейтинга с эло (эло − рейтинг ≤ {newbie.goal_gap}),
        примерно {lower}–{upper} побед
      </p>
    );
  }
  return null;
}
