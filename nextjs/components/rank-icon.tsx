import { Medal } from "lucide-react";

const MEDAL_COLORS: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-400",
  3: "text-amber-700",
};

export function RankIcon({ rank }: { rank: number | null }) {
  if (rank == null) return null;

  const color = MEDAL_COLORS[rank];
  if (color) {
    return <Medal className={`${color} w-5 h-5 flex-shrink-0`} aria-label={`${rank} место`} />;
  }

  return <span>{rank}</span>;
}
