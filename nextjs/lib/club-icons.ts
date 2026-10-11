/**
 * Built-in club icon set — one of the app's image pools (see
 * scripts/generate-image-pools.mjs).
 *
 * Icons live in `public/club-icons/*.svg`; adding one means committing the
 * file and redeploying — the pool manifest regenerates on dev/build. A club
 * stores only an icon *key* (the file name without extension) in the
 * database; an unknown key simply renders nothing, so retiring an icon in a
 * later release can't break rendering.
 *
 * There is intentionally no backend registry — the API only validates the key
 * format, not whether the icon exists.
 */
import { IMAGE_POOLS } from "@/lib/image-pools.gen";

/** File names (with extension) of the built-in club icons, sorted. */
export const CLUB_ICONS: readonly string[] = IMAGE_POOLS["club-icons"];

/** The icon key of a pool file name: "clover.svg" → "clover". */
export function clubIconKey(fileName: string): string {
    return fileName.replace(/\.[a-z0-9]+$/i, "");
}

const ICON_KEYS: ReadonlySet<string> = new Set(CLUB_ICONS.map(clubIconKey));

/** True when `k` is a registered built-in icon key. */
export function isValidClubIcon(k: string | null | undefined): k is string {
    return typeof k === "string" && ICON_KEYS.has(k);
}

/** Absolute-from-root URL for a club icon, respecting the static-export basePath. */
export function clubIconSrc(key: string): string {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return `${basePath}/club-icons/${key}.svg`;
}
