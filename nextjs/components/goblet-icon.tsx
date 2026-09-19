import type { SVGProps } from "react";

/**
 * A goblet in the lucide visual language (24×24 grid, 2px round strokes) —
 * lucide itself ships no goblet icon, and the tournaments entry point wanted
 * one distinct from the trophy of the arenas entry point.
 */
export function GobletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M6 3h12v5a6 6 0 0 1-12 0V3z" />
      <path d="M12 14v7" />
      <path d="M8 21h8" />
    </svg>
  );
}
