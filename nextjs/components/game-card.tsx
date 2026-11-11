import Link from "next/link";
import { GameImage } from "@/components/game-image";
import { accentName, secondaryNames, type GameWithNames } from "@/lib/game-names";
import { cn } from "@/lib/utils";

/**
 * One game as an identity row: box art, the accent name (alias → ru → en),
 * the other names muted underneath. The shared way to say "this game" outside
 * of pickers — the admin list, the offline queue's game-op card, anywhere a
 * game edit needs a face.
 */
export function GameCard({
    game,
    thumbUrl,
    href,
    className,
}: {
    game: GameWithNames;
    thumbUrl?: string | null;
    /** When set, the accent name links there (the game's view page in the admin list). */
    href?: string;
    className?: string;
}) {
    const secondary = secondaryNames(game);
    return (
        <div className={cn("flex items-center gap-2 min-w-0", className)}>
            {thumbUrl && <GameImage src={thumbUrl} alt="" className="size-8 shrink-0 rounded" />}
            <div className="min-w-0">
                {href ? (
                    <Link className="underline font-medium" href={href}>
                        {accentName(game)}
                    </Link>
                ) : (
                    <span className="font-medium">{accentName(game)}</span>
                )}
                {secondary.length > 0 && (
                    <div className="text-sm text-muted-foreground">{secondary.join(" · ")}</div>
                )}
            </div>
        </div>
    );
}
