/**
 * Built-in club icon set.
 *
 * Club icons live in `public/club-icons/<key>.svg` and are version-controlled:
 * adding an icon means committing the SVG file and an entry here. A club stores
 * only an icon *key* in the database; this registry is the single source of truth
 * for which keys exist and how they render.
 *
 * There is intentionally no backend registry — the API only validates the key
 * format, not whether the icon exists. An unknown key simply renders nothing, so
 * retiring an icon in a later release can't break rendering.
 */
export const CLUB_ICONS = [
    { key: "blue-figure", label: "Синяя фигура" },
    { key: "clover", label: "Клевер" },
    { key: "tbonk", label: "Тбонк" },
] as const;

export type ClubIconKey = (typeof CLUB_ICONS)[number]["key"];

const ICON_KEYS: ReadonlySet<string> = new Set(CLUB_ICONS.map((i) => i.key));

/** True when `k` is a registered built-in icon key. */
export function isValidClubIcon(k: string | null | undefined): k is ClubIconKey {
    return typeof k === "string" && ICON_KEYS.has(k);
}

/** Absolute-from-root URL for a club icon, respecting the static-export basePath. */
export function clubIconSrc(key: string): string {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return `${basePath}/club-icons/${key}.svg`;
}
