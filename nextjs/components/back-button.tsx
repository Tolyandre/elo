"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared "back to the list" control so every view/admin page offers the same
 * outline button with an arrow instead of ad-hoc text links.
 *
 * Clicking goes back in the browser history, so the user lands on the exact
 * list state they came from — the feed's filters and scroll position survive.
 * The href target is the fallback for a history-less cold open (a deep link
 * in a fresh tab has nowhere to go back to) and for middle-click / new tab.
 */
export function BackButton({ href, label = "Назад" }: { href: string; label?: string }) {
    return (
        <div className="mb-4">
            <Button asChild variant="outline">
                <Link
                    href={href}
                    onClick={(e) => {
                        if (window.history.length > 1) {
                            e.preventDefault();
                            window.history.back();
                        }
                    }}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {label}
                </Link>
            </Button>
        </div>
    );
}
