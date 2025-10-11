// app/components/NavigationBar.tsx
'use client';                    // компонент клиенский

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavigationBar() {
  const pathname = usePathname();

  // вспомогательная функция для подсветки активной ссылки
  const linkClass = (href: string) =>
    `px-4 py-2 rounded transition-colors ${
      pathname === href
        ? 'bg-indigo-600 text-white font-semibold'
        : 'text-gray-700 hover:bg-gray-200'
    }`;

  return (
    <nav className="shadow">
      <div className="container mx-auto flex items-center gap-4 py-3">
        <Link href="/" className={linkClass('/')}>
          Игроки
        </Link>

        <Link href="/matches" className={linkClass('/matches')}>
          Партии
        </Link>
      </div>
    </nav>
  );
}