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

function WoodPlateSvg({ className }: { className?: string }) {
  // Cheap pine/MDF palette — pale tan, clearly distinct from bronze
  const ribbon = "#C8A96E";
  const plateBody = "#C4955A";    // medium pine
  const plateFace = "#D4AA70";    // light pine
  const grain = "#B8894A";        // slightly darker grain
  const shadow = "#A07840";       // edge shadow
  const textColor = "#3D2408";    // dark brown text

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 24"
      className={cn("flex-shrink-0", className)}
      aria-label="Rank 4 wood plate"
      role="img"
    >
      {/* Ribbon left */}
      <polygon points="7,0 10,0 8,10 5,10" fill={ribbon} opacity="0.9" />
      {/* Ribbon right */}
      <polygon points="10,0 13,0 15,10 12,10" fill={ribbon} opacity="0.7" />
      {/* Board rotated slightly counterclockwise around ribbon base */}
      <g transform="rotate(-6, 9.5, 10)">
        {/* Plate shadow */}
        <rect x="1.5" y="10.5" width="17" height="12" rx="2" fill={shadow} />
        {/* Plate body (landscape) */}
        <rect x="1" y="10" width="17" height="12" rx="2" fill={plateBody} />
        {/* Wood face */}
        <rect x="2" y="11" width="15" height="10" rx="1" fill={plateFace} />
        {/* Curved grain lines */}
        <path d="M 3,13.5 C 6,12.5 11,14.5 16,13"   stroke={grain} strokeWidth="0.65" fill="none" opacity="0.65" />
        <path d="M 3,16   C 7,17.2 10,14.8 16,16.5"  stroke={grain} strokeWidth="0.65" fill="none" opacity="0.65" />
        <path d="M 3,18.5 C 5,17.2 11,19.5 16,18.5"  stroke={grain} strokeWidth="0.65" fill="none" opacity="0.65" />
        {/* Top shine */}
        <rect x="2" y="11" width="15" height="1.8" rx="1" fill="#EDD9A3" opacity="0.3" />
        {/* Rank number */}
        <text
          x="9.5"
          y="18.5"
          textAnchor="middle"
          fontSize="8"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
          fill={textColor}
        >
          4
        </text>
      </g>
    </svg>
  );
}

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

  if (rank === 4) {
    return <WoodPlateSvg className={cn("w-5 h-6", className)} />;
  }

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