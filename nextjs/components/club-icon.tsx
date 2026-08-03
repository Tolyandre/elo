import { Club } from "@/app/api";
import { useClubs } from "@/app/clubsContext";
import { isValidClubIcon, clubIconSrc } from "@/lib/club-icons";
import { cn } from "@/lib/utils";

/**
 * Renders a club's built-in icon. The icon is a version-controlled static SVG
 * in `public/club-icons/<key>.svg`, keyed off `club.icon`. Renders nothing
 * when the club has no icon or the key is not in the built-in set.
 */
export function ClubIcon({
  club,
  className,
}: {
  club: Pick<Club, "name" | "geologist_name" | "icon">;
  className?: string;
}) {
  const { clubDisplayName } = useClubs();
  if (!isValidClubIcon(club.icon)) return null;
  const name = clubDisplayName(club);
  return (
    // Static SVG asset served by file (not next/image): it can't be optimized
    // under `output: export` and is already a tiny vector file.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={clubIconSrc(club.icon)}
      alt={name}
      title={name}
      aria-hidden={false}
      className={cn("inline-block h-4 w-4 shrink-0 align-text-bottom", className)}
    />
  );
}
