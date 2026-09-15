"use client";

import { useEffect, useRef } from "react";
import { Match } from "@/app/api";
import { MatchCard } from "@/components/match-card";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/app/meContext";

/**
 * Arena match list (ADR-24): same MatchCard rendering as /matches, fed by the
 * cursor-paginated arena matches endpoint. The sentinel div triggers the next
 * page when scrolled into view.
 */
export function ArenaMatchesTab({
  matches,
  loading,
  hasMore,
  onLoadMore,
}: {
  matches: Match[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const { roundToInteger } = useMe();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (matches.length === 0 && loading) {
    return <Spinner className="mx-auto my-4" />;
  }

  if (matches.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет партий</p>;
  }

  return (
    <>
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} roundToInteger={roundToInteger} />
      ))}
      <div ref={sentinelRef} className="h-1">
        {loading && hasMore && <Spinner className="mx-auto my-4" />}
      </div>
    </>
  );
}
