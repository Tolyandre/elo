"use client";

import Link from "next/link";
import type { ArenaPlayer } from "@/app/api";
import { RankIcon } from "@/components/rank-icon";
import { ClubIcons } from "@/components/player-name";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Arena medal table (ADR-24), modeled after the tournament stats table:
 * places 1–4 with RankIcon headers, players ordered by medals then matches.
 */
export function ArenaMedalsTab({ players, loading }: { players: ArenaPlayer[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const sorted = [...players].sort(
    (a, b) =>
      b.first_count - a.first_count ||
      b.second_count - a.second_count ||
      b.third_count - a.third_count ||
      b.fourth_count - a.fourth_count ||
      b.matches_count - a.matches_count,
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет партий</p>;
  }

  return (
    <table className="table-auto border-collapse w-full text-sm">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-2 pr-2 font-medium">Игрок</th>
          <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={1} /></div></th>
          <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={2} /></div></th>
          <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={3} /></div></th>
          <th className="py-2 px-1"><div className="flex justify-center"><RankIcon rank={4} /></div></th>
          <th className="py-2 pl-1 text-center font-medium">Партии</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.player_id} className="border-t">
            <td className="py-2 pr-2">
              <ClubIcons playerId={p.player_id} className="mr-1 align-text-bottom" />
              <Link href={`/players/view?id=${p.player_id}`} className="hover:underline">{p.name}</Link>
            </td>
            <td className="py-2 px-1 text-center tabular-nums">{p.first_count || ""}</td>
            <td className="py-2 px-1 text-center tabular-nums">{p.second_count || ""}</td>
            <td className="py-2 px-1 text-center tabular-nums">{p.third_count || ""}</td>
            <td className="py-2 px-1 text-center tabular-nums">{p.fourth_count || ""}</td>
            <td className="py-2 pl-1 text-center tabular-nums">{p.matches_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
