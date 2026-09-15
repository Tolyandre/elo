"use client";

/**
 * Rank-change indicator in the old /players style: plain colored arrows
 * without badge chrome — green ▴ for a rank up, red ▾ for a rank down, and
 * green "New!" for a player entering the ranking.
 */
export function RankChangeIndicator({
  current,
  previous,
}: {
  current: number | null;
  previous?: number | null;
}) {
  if (current == null) return null;

  if (previous == null) {
    return (
      <span className="text-green-600 text-xs" aria-label="New">
        New!
      </span>
    );
  }

  const delta = previous - current;
  if (delta === 0) return null;

  if (delta > 0) {
    return (
      <span className="text-green-600 text-xs" aria-label={`Rank up ${delta}`}>
        <span className="mr-1">▴</span>
        <span>{delta}</span>
      </span>
    );
  }
  return (
    <span className="text-red-600 text-xs" aria-label={`Rank down ${-delta}`}>
      <span className="mr-1">▾</span>
      <span>{-delta}</span>
    </span>
  );
}

/**
 * Rating cell value with the pale-gray diff of the old /players page. The
 * diff keeps a reserved slot so the numbers stay in a column when it appears
 * or disappears between periods.
 */
export function RatingDiff({ current, previous }: { current: number; previous?: number | null }) {
  const diff = previous != null && previous !== current ? current - previous : null;
  return (
    <span className="whitespace-nowrap">
      <span className="inline-block min-w-10 text-right tabular-nums">{current.toFixed(0)}</span>
      <span className="inline-block min-w-14 text-sm text-gray-500">
        {diff == null ? "" : `(${diff > 0 ? "+" : ""}${diff.toFixed(1)})`}
      </span>
    </span>
  );
}
