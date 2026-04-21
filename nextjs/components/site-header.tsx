"use client"

import { usePageHeaderContext } from "@/app/pageHeaderContext"
import { NavigationBar } from "@/components/navigation-bar"

export function SiteHeader() {
  const { title, action } = usePageHeaderContext()

  return (
    <header className="flex flex-col sm:flex-row sm:items-center w-full space-y-3 px-3">
      {/* Навигация: первая строка на мобиле, правый край на десктопе */}
      <div className="order-first sm:order-last sm:ml-auto">
        <NavigationBar />
      </div>

      {/* Заголовок + кнопка действия: вторая строка на мобиле, левый край на десктопе */}
      {(title || action) && (
        <div className="order-last sm:order-first flex items-center justify-between sm:justify-start gap-2 max-w-sm mx-auto w-full pt-2 pb-2 sm:max-w-none sm:mx-0 sm:w-auto sm:pt-0 sm:pb-0">
          {title && <h1 className="text-2xl font-semibold">{title}</h1>}
          {action}
        </div>
      )}
    </header>
  )
}
