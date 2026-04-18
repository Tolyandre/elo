"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

/**
 * Mobile bottom sheet.
 *
 * Layout strategy:
 * - The fixed container tracks `visualViewport` (offsetTop + height) so it
 *   always occupies exactly the visible area, even when the virtual keyboard
 *   is open.  Updating via direct DOM write avoids React re-renders.
 * - The sheet itself takes 90 % of that height, leaving 10 % as a tappable
 *   backdrop at the top.
 * - Drag-to-dismiss is handled on the handle bar.
 * - Body scroll is locked with `position:fixed` (more reliable than
 *   `overflow:hidden` on Android Chrome).
 */
export function BottomSheet({ open, onOpenChange, children, className }: BottomSheetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const sheetRef     = React.useRef<HTMLDivElement>(null)
  const handleRef    = React.useRef<HTMLDivElement>(null)

  // Track visual viewport — resize fires on keyboard open/close AND address-bar show/hide
  React.useEffect(() => {
    if (!open) return

    const update = () => {
      const vv  = window.visualViewport
      const h   = vv?.height   ?? window.innerHeight
      const top = vv?.offsetTop ?? 0

      const container = containerRef.current
      if (container) {
        container.style.top    = `${top}px`
        container.style.height = `${h}px`
      }

      const sheet = sheetRef.current
      if (sheet) {
        // 90 % leaves a tappable backdrop strip at the top
        sheet.style.height = `${Math.round(h * 0.9)}px`
      }
    }

    update()
    window.visualViewport?.addEventListener("resize", update)
    window.visualViewport?.addEventListener("scroll", update)
    return () => {
      window.visualViewport?.removeEventListener("resize", update)
      window.visualViewport?.removeEventListener("scroll", update)
    }
  }, [open])

  // Body scroll lock — position:fixed preserves scroll position on Android
  React.useEffect(() => {
    if (!open) return
    const scrollY = window.scrollY
    document.body.style.position = "fixed"
    document.body.style.top      = `-${scrollY}px`
    document.body.style.left     = "0"
    document.body.style.right    = "0"
    return () => {
      document.body.style.position = ""
      document.body.style.top      = ""
      document.body.style.left     = ""
      document.body.style.right    = ""
      window.scrollTo(0, scrollY)
    }
  }, [open])

  // Escape key
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false) }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onOpenChange])

  // Drag-to-dismiss from the handle bar
  React.useEffect(() => {
    const handle = handleRef.current
    const sheet  = sheetRef.current
    if (!handle || !sheet || !open) return

    let startY   = 0
    let dragging = false

    const onTouchStart = (e: TouchEvent) => {
      startY   = e.touches[0].clientY
      dragging = true
      sheet.style.transition = "none"
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging) return
      const delta = Math.max(0, e.touches[0].clientY - startY)
      sheet.style.transform = `translateY(${delta}px)`
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!dragging) return
      dragging = false
      const delta = e.changedTouches[0].clientY - startY
      if (delta > 80) {
        // Animate out then close
        sheet.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)"
        sheet.style.transform  = "translateY(100%)"
        setTimeout(() => onOpenChange(false), 250)
      } else {
        // Snap back
        sheet.style.transition = "transform 0.2s ease-out"
        sheet.style.transform  = ""
        const cleanup = () => { sheet.style.transition = "" }
        sheet.addEventListener("transitionend", cleanup, { once: true })
      }
    }

    handle.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove",  onTouchMove,  { passive: true })
    window.addEventListener("touchend",   onTouchEnd)
    return () => {
      handle.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove",  onTouchMove)
      window.removeEventListener("touchend",   onTouchEnd)
      sheet.style.transform  = ""
      sheet.style.transition = ""
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 z-50"
      // initial values — overwritten synchronously by the effect above
      style={{ top: 0, height: "100svh" }}
    >
      {/* Backdrop — the top ~10 % strip is visible and tappable */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in-0 duration-200"
        onClick={() => onOpenChange(false)}
      />

      {/* Sheet — sits at bottom-0 of the container, height set by JS */}
      <div
        ref={sheetRef}
        style={{ height: "90svh" }}   // initial — overwritten by effect
        className={cn(
          "absolute bottom-0 left-0 right-0 bg-background border-t rounded-t-xl",
          "flex flex-col overflow-hidden",
          "animate-in slide-in-from-bottom duration-300",
          className
        )}
      >
        {/* Handle bar — drag target */}
        <div
          ref={handleRef}
          className="flex justify-center py-3 touch-none cursor-grab shrink-0"
        >
          <div className="bg-muted h-1.5 w-12 rounded-full" />
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  )
}
