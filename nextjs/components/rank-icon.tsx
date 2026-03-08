import { cn } from "@/lib/utils";

interface MedalConfig {
  ribbonColor: string;
  medalColor: string;
  medalShine: string;
  medalShadow: string;
  textColor: string;
}

const MEDAL_CONFIG: Record<number, MedalConfig> = {
  1: {
    ribbonColor: "#FBBF24",       // yellow-400
    medalColor: "#F59E0B",        // yellow-500
    medalShine: "#FDE68A",        // yellow-200
    medalShadow: "#D97706",       // yellow-600
    textColor: "#78350F",         // yellow-900
  },
  2: {
    ribbonColor: "#94A3B8",       // slate-400
    medalColor: "#64748B",        // slate-500
    medalShine: "#CBD5E1",        // slate-300
    medalShadow: "#475569",       // slate-600
    textColor: "#0F172A",         // slate-900
  },
  3: {
    ribbonColor: "#B45309",       // amber-700
    medalColor: "#92400E",        // amber-800
    medalShine: "#D97706",        // amber-600
    medalShadow: "#78350F",       // amber-900
    textColor: "#FEF3C7",         // amber-50
  },
};

function MedalSvg({ rank, config, className }: { rank: number; config: MedalConfig; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 24"
      className={cn("flex-shrink-0", className)}
      aria-label={`Rank ${rank} medal`}
      role="img"
    >
      {/* Ribbon left */}
      <polygon
        points="7,0 10,0 8,10 5,10"
        fill={config.ribbonColor}
        opacity="0.9"
      />
      {/* Ribbon right */}
      <polygon
        points="10,0 13,0 15,10 12,10"
        fill={config.ribbonColor}
        opacity="0.7"
      />
      {/* Medal circle shadow */}
      <circle cx="10" cy="17" r="7" fill={config.medalShadow} />
      {/* Medal circle main */}
      <circle cx="10" cy="16.5" r="6.5" fill={config.medalColor} />
      {/* Medal shine highlight */}
      <circle cx="8" cy="14.5" r="2.5" fill={config.medalShine} opacity="0.35" />
      {/* Rank number */}
      <text
        x="10"
        y="20.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
        fill={config.textColor}
      >
        {rank}
      </text>
    </svg>
  );
}

export function RankIcon({
  rank,
  className,
}: {
  rank: number | null;
  className?: string;
}) {
  if (rank == null) return null;

  const config = MEDAL_CONFIG[rank];

  if (config) {
    return (
      <MedalSvg
        rank={rank}
        config={config}
        className={cn("w-5 h-6", className)}
      />
    );
  }

  return (
    // <span className={cn("text-sm font-medium tabular-nums", className)}>
    <div className={cn("w-5 h-6 text-center", className)}>
      {rank}
    </div>
  );
}