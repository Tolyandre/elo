import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The standard "nothing here" block: centered muted text in a dashed frame,
 * with an optional icon and action (e.g. a create Button). The only sanctioned
 * empty state for lists and sections — never a bare `<p>`, never nothing.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center",
        className
      )}
    >
      {Icon && <Icon className="size-6 text-muted-foreground" />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {children}
      {action}
    </div>
  )
}
