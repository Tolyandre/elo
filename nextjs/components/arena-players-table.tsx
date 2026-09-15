"use client";

import Link from "next/link";
import { ArenaPlayer } from "@/app/api";
import { RankIcon } from "@/components/rank-icon";

const LEAGUE_TITLES: Record<string, string> = {
  elite: "Высшая лига",
  amateur: "Любители",
  newbie: "Новички",
};

/**
 * Ranked arena players table (ADR-24): rank icon, name, rating and the
 * newbie/elite hints. When the arena has leagues, players arrive grouped —
 * the caller passes the groups; otherwise a single list is rendered.
 */
export function ArenaPlayersTable({ players }: { players: ArenaPlayer[] }) {
  if (players.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет игроков</p>;
  }
  return (
    <table className="table-auto border-collapse w-full text-sm">
      <tbody>
        {players.map((player) => (
          <tr key={player.player_id}>
            <td className="px-1 py-2">
              {player.rank != null ? <RankIcon rank={player.rank} /> : null}
            </td>
            <td className="px-4 py-2">
              <PlayerName player={player} />
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
            <td className="px-1 py-2 tabular-nums text-right">{player.rating.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlayerName({ player }: { player: ArenaPlayer }) {
  return (
    <Link href={`/players/view?id=${player.player_id}`} className="hover:underline">
      {player.name}
    </Link>
  );
}

/**
 * Players grouped by league in promotion order (elite → amateur → newbie when
 * present). A league-less arena renders one table without headers.
 */
export function ArenaPlayersGroups({
  players,
  leagues,
}: {
  players: ArenaPlayer[];
  leagues: string[];
}) {
  if (leagues.length === 0) {
    return <ArenaPlayersTable players={players} />;
  }
  return (
    <>
      {leagues.map((league) => {
        const leaguePlayers = players.filter((p) => p.league === league);
        return (
          <div key={league}>
            <h2 className="text-lg font-semibold mb-2 mt-4">{LEAGUE_TITLES[league] ?? league}</h2>
            <ArenaPlayersTable players={leaguePlayers} />
          </div>
        );
      })}
    </>
  );
}

