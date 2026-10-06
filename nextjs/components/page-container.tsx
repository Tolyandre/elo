import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one page container. Every page wraps its content in this instead of
 * hand-rolling `max-w-* mx-auto p-4 space-y-*`: the root shell (app/layout.tsx)
 * already supplies the outer inset, so the container only owns width and
 * vertical rhythm. Widths:
 *  - narrow (default): list/detail pages (max-w-sm)
 *  - form:             create/edit forms (max-w-md)
 *  - wide:             stat tables, formula tuning, debug (max-w-3xl)
 *  - full:             dense desktop CRUD tables, uncapped
 */
const widthClasses = {
  narrow: "max-w-sm",
  form: "max-w-md",
  wide: "max-w-3xl",
  full: "max-w-none",
} as const

export function PageContainer({
  width = "narrow",
  className,
  ...props
}: React.ComponentProps<"main"> & { width?: keyof typeof widthClasses }) {
  return (
    <main
      data-slot="page-container"
      data-width={width}
      className={cn("mx-auto w-full space-y-6", widthClasses[width], className)}
      {...props}
    />
  )
}
