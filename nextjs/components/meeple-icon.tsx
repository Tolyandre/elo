import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/**
 * Hand-drawn board-game meeple (the classic Carcassonne follower: round head,
 * drooping arms, flared skirt) in the lucide icon style — 24×24 grid,
 * currentColor stroke of width 2 — so it can be used anywhere a lucide icon
 * is (nav links, `EmptyState icon={...}`, `PageHeader icon={...}`).
 */
export const MeepleIcon = forwardRef<SVGSVGElement, LucideProps>(
    function MeepleIcon({ className, size = 24, ...props }, ref) {
        return (
            <svg
                ref={ref}
                xmlns="http://www.w3.org/2000/svg"
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Фигурка игрока (meeple)"
                className={className}
                {...props}
            >
                <path d="M12 3c1.17 0 2.01.64 2.5 1.43.43.72.61 1.55.65 2.27 1.32.68 2.79 1.36 3.97 2.05 1.57 1.13 1.98 1.52 2.28 2.49 0 .61-.3.94-.68 1.08-.32.23-1.52.58-3.23.71.65 1.15 1.51 2.21 2.27 3.22.88 1.17 1.64 2.42 1.64 3.54 0 .41-.2.96-1.18 1.12h-16.44c-.98-.16-1.18-.71-1.18-1.12 0-1.12.76-2.37 1.64-3.54.76-1.01 1.62-2.07 2.27-3.22-1.71-.13-2.91-.48-3.23-.71-.38-.14-.68-.47-.68-1.08.3-.97.71-1.36 2.28-2.49 1.18-.69 2.65-1.37 3.97-2.05.04-.72.22-1.55.65-2.27.49-.79 1.33-1.43 2.5-1.43Z" />
            </svg>
        );
    },
);
