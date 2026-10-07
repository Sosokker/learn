import { Button, LanguageSwitch, SidebarNavItem, Spinner, useI18n } from "@app/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation, useSearch } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { authClient, signInWithGoogle } from "./auth.ts"
import { type CategoryNode, categoryName, categoryTree } from "./format.ts"
import { CompassIcon, FlagIcon, FolderIcon, HomeIcon, LibraryIcon, MenuIcon } from "./icons.tsx"
import { categoriesQuery } from "./queries.ts"
import { useViewer } from "./session.ts"

// The app frame, Linear style: a left sidebar (navigation, categories, language, account) and
// the page. Below `md` the sidebar is a drawer opened from a top bar.
export function Shell(props: { readonly children: ReactNode }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  // A navigation closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change only
  useEffect(() => setOpen(false), [location.href])

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
      menuButton.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <div className="flex min-h-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-body-sm text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("app.skipToContent")}
      </a>

      {open ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="fixed inset-0 z-30 bg-overlay/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="sidebar"
        aria-label={t("nav.main")}
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col border-r border-hairline bg-surface-1 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:max-w-none md:shrink-0`}
      >
        <div className="flex h-12 items-center justify-between gap-2 px-4">
          <Link to="/" className="text-body-sm font-semibold text-ink no-underline">
            {t("app.name")}
          </Link>
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t("nav.closeSidebar")}
            onClick={() => {
              setOpen(false)
              menuButton.current?.focus()
            }}
          >
            <span aria-hidden className="text-body">
              ×
            </span>
          </Button>
        </div>
        <nav
          aria-label={t("nav.main")}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pb-4"
        >
          <ul className="flex flex-col gap-0.5">
            <NavLink to="/" label={t("nav.home")} icon={<HomeIcon />} exact />
            <NavLink to="/guide" label={t("nav.guide")} icon={<FlagIcon />} />
            <NavLink to="/library" label={t("nav.library")} icon={<LibraryIcon />} />
            <NavLink to="/explore" label={t("nav.explore")} icon={<CompassIcon />} />
          </ul>
          <Categories />
        </nav>
        <div className="flex flex-col gap-3 border-t border-hairline p-3">
          <LanguageSwitch />
          <Account />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-hairline bg-canvas px-2 md:hidden">
          <Button
            ref={menuButton}
            variant="ghost"
            size="icon"
            aria-label={t("nav.openSidebar")}
            aria-expanded={open}
            aria-controls="sidebar"
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </Button>
          <Link to="/" className="text-body-sm font-semibold text-ink no-underline">
            {t("app.name")}
          </Link>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 md:px-10 md:py-8"
        >
          {props.children}
        </main>
      </div>
    </div>
  )
}

function NavLink(props: {
  readonly to: "/" | "/guide" | "/library" | "/explore"
  readonly label: string
  readonly icon: ReactNode
  readonly exact?: boolean
}) {
  const location = useLocation()
  const search = useSearch({ strict: false })
  const onPath =
    props.exact === true ? location.pathname === props.to : location.pathname.startsWith(props.to)
  // Explore filtered by a category is shown as that category, not as Explore.
  const active = onPath && !(props.to === "/explore" && "category" in search && search.category !== undefined)
  return (
    <li>
      <SidebarNavItem label={props.label} icon={props.icon} active={active} render={<Link to={props.to} />} />
    </li>
  )
}

function Categories() {
  const { t } = useI18n()
  const categories = useQuery(categoriesQuery)
  if (categories.data === undefined || categories.data.length === 0) return null
  return (
    <section aria-labelledby="sidebar-categories" className="flex flex-col gap-1">
      <h2 id="sidebar-categories" className="px-2 text-caption font-medium text-ink-tertiary">
        {t("nav.categories")}
      </h2>
      <CategoryList nodes={categoryTree(categories.data)} depth={0} />
    </section>
  )
}

function CategoryList(props: { readonly nodes: ReadonlyArray<CategoryNode>; readonly depth: number }) {
  const { locale } = useI18n()
  const location = useLocation()
  const search = useSearch({ strict: false })
  const current = location.pathname === "/explore" && "category" in search ? search.category : undefined
  return (
    <ul
      className={
        props.depth === 0
          ? "flex flex-col gap-0.5"
          : "ml-4 flex flex-col gap-0.5 border-l border-hairline pl-1"
      }
    >
      {props.nodes.map((node) => (
        <li key={node.category.id}>
          <SidebarNavItem
            label={categoryName(node.category, locale)}
            icon={props.depth === 0 ? <FolderIcon /> : undefined}
            active={current === node.category.id}
            render={<Link to="/explore" search={{ category: node.category.id }} />}
          />
          {node.children.length === 0 ? null : <CategoryList nodes={node.children} depth={props.depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

function Account() {
  const { t } = useI18n()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  if (viewer.pending) return <Spinner size="sm" label={t("common.loading")} />
  if (viewer.user === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(false)
            signInWithGoogle().catch(() => {
              setBusy(false)
              setError(true)
            })
          }}
        >
          <GoogleMark />
          {t("auth.signInWithGoogle")}
        </Button>
        {error ? (
          <p role="alert" className="text-caption text-danger">
            {t("auth.signInError")}
          </p>
        ) : null}
      </div>
    )
  }
  const user = viewer.user
  return (
    <div className="flex items-center gap-2">
      {user.image === null ? (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-caption font-medium"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img src={user.image} alt="" className="size-7 shrink-0 rounded-full" referrerPolicy="no-referrer" />
      )}
      <span className="min-w-0 flex-1 truncate text-dense text-ink-muted" title={user.email}>
        <span className="sr-only">{t("auth.signedInAs", { name: user.name })}</span>
        <span aria-hidden>{user.name}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void authClient.signOut().finally(() => {
            setBusy(false)
            // Everything cached was read as this user.
            queryClient.removeQueries()
          })
        }}
      >
        {t("auth.signOut")}
      </Button>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  )
}
