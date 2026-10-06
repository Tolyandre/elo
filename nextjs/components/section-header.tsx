import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one style for in-page section headings (`text-base font-semibold`).
 * Replaces the ad-hoc text-lg/text-sm/muted variants scattered across pages.
 * The page title itself is not this — it renders once in the site header via
 * PageHeader (app/pageHeaderContext.tsx).
 */
export function SectionHeader({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="section-header"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}
