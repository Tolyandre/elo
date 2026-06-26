"use client";

import * as React from "react";
import { Club } from "@/app/api";
import { useClubs } from "@/app/clubsContext";
import { cn } from "@/lib/utils";

/**
 * Renders a club's icon as an inline image. The SVG is delivered as a data-URI through an
 * <img> tag, which never executes embedded scripts — so untrusted SVG cannot run JS here.
 * Renders nothing when the club has no icon.
 */
export function ClubIcon({
  club,
  className,
}: {
  club: Pick<Club, "name" | "geologist_name" | "icon_svg">;
  className?: string;
}) {
  const { clubDisplayName } = useClubs();
  if (!club.icon_svg) return null;
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(club.icon_svg)}`;
  const name = clubDisplayName(club);
  return (
    // Inline data-URI SVG: <img> (not next/image) is deliberate — it renders the icon
    // without executing any embedded script, and a data URI cannot be optimized anyway.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      title={name}
      aria-hidden={false}
      className={cn("inline-block h-4 w-4 shrink-0 align-text-bottom", className)}
    />
  );
}
