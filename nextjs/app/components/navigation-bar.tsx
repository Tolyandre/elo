'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import RefreshButton from './RefreshButton';
import { usePlayers } from '../players/PlayersContext';
import { useMatches } from '../matches/MatchesContext';

export function NavigationBar() {
  const pathname = usePathname();
  const { invalidate: invalidatePlayers } = usePlayers();
  const { invalidate: invalidateMatches } = useMatches();

  const linkClass = (href: string) =>
    `px-4 py-2 rounded transition-colors ${pathname === href
      ? 'bg-indigo-600 text-white font-semibold'
      : 'text-gray-700 hover:bg-gray-200'
    }`;

  return (
    <nav className="shadow">
      <div className="container mx-auto flex items-center gap-4 py-3">
        <Link href="/players" className={linkClass('/players')}>
          Игроки
        </Link>

        <Link href="/matches" className={linkClass('/matches')}>
          Партии
        </Link>

        <RefreshButton onInvalidate={() => {
          invalidatePlayers();
          invalidateMatches();
        }} />
      </div>
    </nav>
  );
}