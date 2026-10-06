import * as React from "react"

/**
 * Mobile-first data presentation for tabular content: a stacked card/list
 * layout on phones (`mobile` slot), the real table from `sm` up (`desktop`
 * slot, horizontally scrollable when dense). The shared replacement for the
 * per-page `sm:hidden` / `hidden sm:block` duplication.
 */
export function ResponsiveTable({
  mobile,
  desktop,
  className,
}: {
  mobile: React.ReactNode
  desktop: React.ReactNode
  className?: string
}) {
  return (
    <div data-slot="responsive-table" className={className}>
      <div className="sm:hidden">{mobile}</div>
      <div className="hidden sm:block overflow-x-auto">{desktop}</div>
    </div>
  )
}
