import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The standard list-loading placeholder: `count` skeleton rows at list-item
 * height. The only sanctioned loading state for page content — no «Загрузка...»
 * paragraphs. Use ui/spinner inside buttons and dialogs instead.
 */
export function LoadingRows({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div
      data-slot="loading-rows"
      aria-busy="true"
      className={cn("space-y-2", className)}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  )
}
