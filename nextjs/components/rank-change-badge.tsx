"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Rank-change indicator for the arena players tab, built on the shadcn Badge:
 * a green-tinted secondary badge for a rank up, destructive for a rank down,
 * and a default badge for a player entering the ranking.
 */
export function RankChangeBadge({
  current,
  previous,
}: {
  current: number | null;
  previous?: number | null;
}) {
  if (current == null) return null;

  if (previous == null) {
    return (
      <Badge variant="default" aria-label="New">
        New
      </Badge>
    );
  }

  const delta = previous - current;
  if (delta === 0) return null;

  if (delta > 0) {
    return (
      <Badge variant="secondary" className="text-green-600" aria-label={`Rank up ${delta}`}>
        ▴ {delta}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" aria-label={`Rank down ${-delta}`}>
      ▾ {-delta}
    </Badge>
  );
}

/**
 * Rating cell: the value in a fixed-width right-aligned slot with the diff in
 * its own fixed-width slot after it, so numbers stay in a column and don't
 * shift when the diff appears or disappears between periods.
 */
export function RatingDiff({ current, previous }: { current: number; previous?: number | null }) {
  const diff = previous != null && previous !== current ? current - previous : null;
  return (
    <span className="whitespace-nowrap">
      <span className="inline-block min-w-10 text-right tabular-nums">{current.toFixed(0)}</span>
      <span
        className={`inline-block min-w-14 text-xs ${
          diff == null ? "" : diff > 0 ? "text-green-600" : "text-destructive"
        }`}
      >
        {diff == null ? "" : `(${diff > 0 ? "+" : ""}${diff.toFixed(1)})`}
      </span>
    </span>
  );
}
