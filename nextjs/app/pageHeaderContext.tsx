"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

type PageHeaderContextType = {
  title: string | null
  setTitle: (title: string | null) => void
  action: React.ReactNode | null
  setAction: (action: React.ReactNode | null) => void
}

const PageHeaderContext = createContext<PageHeaderContextType | null>(null)

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [action, setAction] = useState<React.ReactNode | null>(null)

  return (
    <PageHeaderContext.Provider value={{ title, setTitle, action, setAction }}>
      {children}
    </PageHeaderContext.Provider>
  )
}

export function usePageHeaderContext() {
  const ctx = useContext(PageHeaderContext)
  if (!ctx) throw new Error("usePageHeaderContext must be used within PageHeaderProvider")
  return ctx
}

export function PageHeader({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  const { setTitle, setAction } = usePageHeaderContext()

  useEffect(() => {
    setTitle(title)
    setAction(action ?? null)
    return () => {
      setTitle(null)
      setAction(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, action])

  return null
}
