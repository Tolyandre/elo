"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HELP_ARTICLES } from "./help-nav"

/**
 * The documentation shell: an article sidebar on desktop (sticky, active
 * article highlighted) that collapses into a wrapping chip row on mobile,
 * with the article content to the right.
 */
export function HelpShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    return (
        <div className="flex flex-col gap-4 py-6 md:flex-row md:gap-8">
            <aside className="shrink-0 md:w-52">
                <nav
                    aria-label="Справка"
                    className="flex flex-wrap gap-1 md:sticky md:top-4 md:flex-col"
                >
                    {HELP_ARTICLES.map((a) => {
                        const active = pathname === a.href;
                        return (
                            <Link
                                key={a.href}
                                href={a.href}
                                aria-current={active ? "page" : undefined}
                                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                                    active
                                        ? "bg-muted font-medium text-foreground"
                                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                }`}
                            >
                                {a.navTitle}
                            </Link>
                        );
                    })}
                </nav>
            </aside>
            <div className="min-w-0 flex-1 space-y-10">{children}</div>
        </div>
    );
}
