"use client";

import React from "react";
import Link from "next/link";
import { getMarketsByMatchIdPromise, Match, Market } from "@/app/api";
import { MatchCard } from "@/components/match-card";
import { MarketCard } from "@/components/market-card";
import { ErrorAlert } from "@/components/error-alert";

/**
 * A match card that lazily loads and shows the markets the match resolved
 * (shared by /matches and the arena match timelines).
 */
export function MatchWithMarkets({ match, roundToInteger }: { match: Match; roundToInteger: boolean }) {
  const [relatedMarkets, setRelatedMarkets] = React.useState<Market[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!match.has_markets) return;
    getMarketsByMatchIdPromise(match.id)
      .then((data) => setRelatedMarkets(data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Ошибка загрузки ставок"));
  }, [match.id, match.has_markets]);

  return (
    <div>
      <MatchCard match={match} roundToInteger={roundToInteger} clickable />
      {error && <ErrorAlert message={error} className="mt-2" />}
      {relatedMarkets.length > 0 && (
        <div className="space-y-3 mt-3">
          {relatedMarkets.map((market) => (
            <Link key={market.id} href={`/markets/view?id=${market.id}`}>
              <MarketCard market={market} className="hover:bg-accent transition-colors cursor-pointer" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
