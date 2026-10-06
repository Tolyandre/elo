import Link from "next/link";

// The official "Powered by BGG" attribution mark: the XML API Terms of Use
// require it on public-facing apps, linked back to BoardGameGeek, sized so
// the wordmark stays legible (ADR-31). Two variants from BGG's official logo
// kit — dark text for the light theme, reversed white for the dark one.
const bggLogoSrc = (reversed: boolean) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/bgg/powered-by-bgg${reversed ? "-reversed" : ""}-rgb.svg`;

export function SiteFooter() {
  return (
    <footer className="flex justify-center pb-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Данные об играх — BoardGameGeek</span>
        <Link
          href="https://boardgamegeek.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Powered by BoardGameGeek"
          className="inline-block opacity-80 transition-opacity hover:opacity-100"
        >
          {/* Static SVG assets served by file (not next/image): they can't be
              optimized under `output: export` and are tiny vector files. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bggLogoSrc(false)} alt="" className="h-7 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bggLogoSrc(true)} alt="" className="hidden h-7 w-auto dark:inline-block" />
        </Link>
      </div>
    </footer>
  );
}
