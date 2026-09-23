"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CheckIcon, Link2Icon } from "lucide-react"

const LEVEL_CLASS = {
    2: "text-xl font-semibold mt-2",
    3: "text-base font-semibold mt-2",
} as const;

/**
 * A documentation section heading with its own anchor: the button by the
 * title copies the section's URL (current address + #id) to the clipboard,
 * so a reader can share a link straight to the section.
 */
export function AnchorHeading({ id, level = 2, children }: {
    id: string;
    level?: keyof typeof LEVEL_CLASS;
    children: React.ReactNode;
}) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const copy = useCallback(() => {
        const url = `${window.location.href.split("#")[0]}#${id}`;
        void navigator.clipboard?.writeText(url).catch(() => {});
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
    }, [id]);

    const Heading = (`h${level}`) as "h2" | "h3";
    return (
        <Heading id={id} className={`group flex scroll-mt-6 items-center gap-1.5 ${LEVEL_CLASS[level]}`}>
            {children}
            <button
                type="button"
                aria-label="Скопировать ссылку на раздел"
                title="Скопировать ссылку на раздел"
                onClick={copy}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-70 transition-opacity hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
                {copied
                    ? <CheckIcon className="size-4 text-green-600 dark:text-green-400" />
                    : <Link2Icon className="size-4" />}
            </button>
        </Heading>
    );
}
