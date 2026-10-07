import type { Me } from "@app/domain"
import {
  Button,
  ChevronRightIcon,
  CompassIcon,
  cn,
  GoogleIcon,
  HomeIcon,
  LibraryIcon,
  Menu,
  SegmentedControl,
  SettingsIcon,
  Skeleton,
  type UiLang,
  useI18n,
  useToast,
} from "@app/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { signInWithGoogle, signOut } from "../lib/auth.ts"
import { ancestors, buildTree, type CategoryNode, categoryName } from "../lib/categories.ts"
import { categoriesQuery, meQuery } from "../lib/queries.ts"

const navItem =
  "flex h-7 items-center gap-2 rounded-md px-2 text-dense text-ink-muted transition-colors duration-100 " +
  "hover:bg-surface-2 hover:text-ink data-[status=active]:bg-surface-2 data-[status=active]:text-ink max-md:h-9"

export function Sidebar() {
  const { t } = useI18n()
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center px-4">
        <Link to="/" className="flex items-center gap-2 rounded-md text-body-sm font-semibold text-ink">
          <LogoMark />
          {t("app.name")}
        </Link>
      </div>
      <nav aria-label={t("nav.main")} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4">
        <ul className="flex flex-col gap-px">
          <li>
            <Link to="/" activeOptions={{ exact: true }} className={navItem}>
              <HomeIcon className="text-ink-subtle" />
              {t("nav.home")}
            </Link>
          </li>
          <li>
            <Link to="/explore" activeOptions={{ includeSearch: false }} className={navItem}>
              <CompassIcon className="text-ink-subtle" />
              {t("nav.explore")}
            </Link>
          </li>
          <li>
            <Link to="/library" className={navItem}>
              <LibraryIcon className="text-ink-subtle" />
              {t("nav.library")}
            </Link>
          </li>
        </ul>
        <CategoryTree />
      </nav>
      <div className="flex shrink-0 flex-col gap-2 border-t border-hairline p-3">
        <LanguageSwitch />
        <UserSection />
      </div>
    </div>
  )
}

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-primary)" />
      <path
        d="M11 8.5v15h10"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CategoryTree() {
  const { t } = useI18n()
  const categories = useQuery(categoriesQuery)
  const location = useRouterState({ select: (s) => s.location })
  const active =
    location.pathname === "/explore" ? (location.search as { category?: string }).category : undefined
  const tree = useMemo(() => (categories.data ? buildTree(categories.data) : []), [categories.data])
  const openByDefault = useMemo(
    () => new Set(categories.data && active ? ancestors(categories.data, active) : []),
    [categories.data, active],
  )

  return (
    <div className="mt-5 flex flex-col">
      <h2 className="px-2 pb-1 text-caption font-medium text-ink-subtle">{t("nav.categories")}</h2>
      {categories.isPending ? (
        <div className="flex flex-col gap-2 px-2 pt-1" role="status" aria-label={t("common.loading")}>
          {[60, 45, 70, 50, 55].map((w) => (
            <Skeleton key={w} className="h-3.5 rounded-xs" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : categories.isError ? (
        <p className="px-2 text-caption text-ink-tertiary">{t("nav.categoriesError")}</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {tree.map((node) => (
            <CategoryItem key={node.category.id} node={node} active={active} openByDefault={openByDefault} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CategoryItem({
  node,
  active,
  openByDefault,
}: {
  node: CategoryNode
  active: string | undefined
  openByDefault: ReadonlySet<string>
}) {
  const { t, lang } = useI18n()
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? openByDefault.has(node.category.id)
  const name = categoryName(node.category, lang)
  const hasChildren = node.children.length > 0
  const isActive = active === node.category.id
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: node.depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(open ? "nav.collapse" : "nav.expand", { name })}
            onClick={() => setToggled(!open)}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-2 hover:text-ink max-md:size-8"
          >
            <ChevronRightIcon
              className={cn("size-3 transition-transform duration-100", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0 max-md:size-8" />
        )}
        <Link
          to="/explore"
          search={{ category: node.category.id }}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center truncate rounded-md px-1.5 text-dense transition-colors duration-100 hover:bg-surface-2 hover:text-ink max-md:h-9",
            isActive ? "bg-surface-2 text-ink" : "text-ink-subtle",
          )}
        >
          <span className="truncate">{name}</span>
        </Link>
      </div>
      {hasChildren && open ? (
        <ul className="flex flex-col gap-px">
          {node.children.map((child) => (
            <CategoryItem
              key={child.category.id}
              node={child}
              active={active}
              openByDefault={openByDefault}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <SegmentedControl<UiLang>
      label={t("lang.label")}
      value={lang}
      onChange={setLang}
      size="sm"
      className="w-full [&>label]:flex-1"
      options={[
        { value: "en", label: "EN", title: t("lang.en") },
        { value: "th", label: "ไทย", title: t("lang.th") },
      ]}
    />
  )
}

export function Avatar({ me, className }: { me: Pick<Me, "name" | "image" | "handle">; className?: string }) {
  const initial = (me.name || me.handle).slice(0, 1).toUpperCase()
  return me.image ? (
    <img
      src={me.image}
      alt=""
      referrerPolicy="no-referrer"
      className={cn("size-6 shrink-0 rounded-full bg-surface-3", className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-caption font-medium text-ink-muted",
        className,
      )}
    >
      {initial}
    </span>
  )
}

function UserSection() {
  const { t } = useI18n()
  const me = useQuery(meQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (me.isPending) return <Skeleton className="h-8 rounded-md max-md:h-9" />

  if (!me.data) {
    const onSignIn = async () => {
      setBusy(true)
      const ok = await signInWithGoogle().catch(() => false)
      // On success the browser is already leaving for Google.
      if (!ok) {
        setBusy(false)
        toast(t("auth.signInFailed"), "danger")
      }
    }
    return (
      <Button variant="secondary" className="w-full" onClick={onSignIn} disabled={busy}>
        <GoogleIcon className="size-3.5" />
        {t("auth.signIn")}
      </Button>
    )
  }

  const onSignOut = async () => {
    await signOut().catch(() => undefined)
    queryClient.setQueryData(meQuery.queryKey, null)
    queryClient.removeQueries({ queryKey: ["library"] })
    queryClient.removeQueries({ queryKey: ["tokens"] })
    await queryClient.invalidateQueries({ queryKey: ["lesson"] })
    await navigate({ to: "/" })
  }

  const user = me.data
  return (
    <Menu
      align="start"
      side="top"
      trigger={
        <button
          type="button"
          aria-label={t("auth.account")}
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-dense text-ink-muted hover:bg-surface-2 hover:text-ink max-md:h-10"
        >
          <Avatar me={user} />
          <span className="min-w-0 flex-1 truncate">@{user.handle}</span>
        </button>
      }
      entries={[
        { kind: "label", label: user.email },
        { label: t("nav.settings"), icon: <SettingsIcon />, onSelect: () => navigate({ to: "/settings" }) },
        { kind: "separator" },
        { label: t("auth.signOut"), onSelect: onSignOut },
      ]}
    />
  )
}
