import { IconButton, MenuIcon, Sheet, useT } from "@app/ui"
import { useRouterState } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { Sidebar } from "./Sidebar.tsx"

const ShellContext = createContext<{ openNav: () => void }>({ openNav: () => {} })

// Sidebar on the left (a drawer at ≤ 768px), page on the right. Each page renders its own TopBar.
export function Shell({ children }: { children: ReactNode }) {
  const t = useT()
  const [navOpen, setNavOpen] = useState(false)
  const href = useRouterState({ select: (s) => s.location.href })

  // Close the drawer after navigating from it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change on purpose
  useEffect(() => setNavOpen(false), [href])

  const value = useMemo(() => ({ openNav: () => setNavOpen(true) }), [])
  return (
    <ShellContext.Provider value={value}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface-3 px-3 py-2 text-dense text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("app.skip")}
      </a>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-hairline bg-canvas md:block">
          <Sidebar />
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen} title={t("nav.title")}>
          <Sidebar />
        </Sheet>
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {children}
        </main>
      </div>
    </ShellContext.Provider>
  )
}

export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  const t = useT()
  const { openNav } = useContext(ShellContext)
  useEffect(() => {
    document.title = title ? `${title} · Learn` : "Learn"
  }, [title])
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-canvas/95 px-6 backdrop-blur max-md:px-2">
      <IconButton className="md:hidden" label={t("nav.open")} onClick={openNav}>
        <MenuIcon />
      </IconButton>
      <h1 className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink">{title}</h1>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </header>
  )
}
