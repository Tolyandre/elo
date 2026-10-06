import { cn } from "@/lib/utils";

// Box art hotlinked from BoardGameGeek (ADR-31): the URL is stored on the
// game row, the image itself loads from cf.geekdo-images.com and is cached by
// the service worker. Remote images can't go through next/image under
// `output: export`, so a plain <img> with caller-set dimensions it is.
export function GameImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={cn("bg-muted object-cover", className)} />
  );
}
