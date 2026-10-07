import type { LessonSummary, Me } from "@app/domain"
import {
  Button,
  IconButton,
  LibraryIcon,
  LinkIcon,
  Menu,
  MoreIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  UploadIcon,
  useI18n,
  useToast,
} from "@app/ui"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { ConfirmDialog } from "../components/ConfirmDialog.tsx"
import { DetailsDialog } from "../components/DetailsDialog.tsx"
import { LessonRow } from "../components/LessonRow.tsx"
import { RequireAuth } from "../components/RequireAuth.tsx"
import { TopBar } from "../components/Shell.tsx"
import { EmptyState, ErrorState, RowSkeletons } from "../components/states.tsx"
import { UploadDialog } from "../components/UploadDialog.tsx"
import { call } from "../lib/api.ts"
import { categoryName } from "../lib/categories.ts"
import { copyText } from "../lib/clipboard.ts"
import { categoriesQuery, libraryQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/library")({ component: LibraryRoute })

function LibraryRoute() {
  const { t } = useI18n()
  return (
    <RequireAuth title={t("library.title")} reason={t("auth.requiredLibrary")}>
      {(me) => <LibraryPage me={me} />}
    </RequireAuth>
  )
}

function LibraryPage({ me }: { me: Me }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const queryClient = useQueryClient()
  const library = useInfiniteQuery(libraryQuery)
  const categories = useQuery(categoriesQuery)
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id as string, categoryName(c, lang)])),
    [categories.data, lang],
  )

  const [uploadOpen, setUploadOpen] = useState(false)
  const [versionTarget, setVersionTarget] = useState<LessonSummary | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<LessonSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LessonSummary | null>(null)

  const lessons = library.data?.pages.flatMap((p) => p.items) ?? []

  const copyLink = async (lesson: LessonSummary) => {
    const url = `${window.location.origin}/@${lesson.owner.handle}/${lesson.slug}`
    if (await copyText(url)) toast(t("library.linkCopied"), "success")
    else toast(t("library.copyFailed", { url }), "danger")
  }

  const remove = async (lesson: LessonSummary) => {
    await call((c) => c.lessons.remove({ params: { id: lesson.id } }))
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
    ])
    queryClient.removeQueries({ queryKey: ["lesson", lesson.owner.handle, lesson.slug] })
    toast(t("library.deleted"))
  }

  return (
    <>
      <TopBar title={t("library.title")}>
        <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
          <UploadIcon className="size-3.5" />
          {t("library.upload")}
        </Button>
      </TopBar>

      {library.isPending ? (
        <RowSkeletons count={6} />
      ) : library.isError && lessons.length === 0 ? (
        <ErrorState error={library.error} onRetry={() => library.refetch()} />
      ) : lessons.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon />}
          title={t("library.empty")}
          body={t("library.emptyBody")}
          action={
            <Button variant="primary" onClick={() => setUploadOpen(true)}>
              <UploadIcon className="size-3.5" />
              {t("library.upload")}
            </Button>
          }
        />
      ) : (
        <div>
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              owned
              meta={
                <span className="max-w-36 truncate max-lg:hidden">
                  {lesson.categoryId ? (categoryNames.get(lesson.categoryId) ?? lesson.categoryId) : null}
                </span>
              }
              actions={
                <Menu
                  trigger={
                    <IconButton label={t("common.more")} size="sm">
                      <MoreIcon />
                    </IconButton>
                  }
                  entries={[
                    {
                      label: t("library.copyLink"),
                      icon: <LinkIcon />,
                      onSelect: () => void copyLink(lesson),
                    },
                    {
                      label: t("library.details"),
                      icon: <SettingsIcon />,
                      onSelect: () => setDetailsTarget(lesson),
                    },
                    {
                      label: t("library.addVersion"),
                      icon: <PlusIcon />,
                      onSelect: () => setVersionTarget(lesson),
                    },
                    { kind: "separator" },
                    {
                      label: t("library.delete"),
                      icon: <TrashIcon />,
                      danger: true,
                      onSelect: () => setDeleteTarget(lesson),
                    },
                  ]}
                />
              }
            />
          ))}
          {library.hasNextPage ? (
            <div className="flex justify-center px-6 py-6">
              <Button onClick={() => library.fetchNextPage()} disabled={library.isFetchingNextPage}>
                {library.isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} handle={me.handle} />
      <UploadDialog
        open={versionTarget !== null}
        onOpenChange={(open) => !open && setVersionTarget(null)}
        handle={me.handle}
        target={versionTarget ?? undefined}
      />
      <DetailsDialog lesson={detailsTarget} onOpenChange={(open) => !open && setDetailsTarget(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("library.deleteTitle", { title: deleteTarget?.title ?? "" })}
        body={t("library.deleteBody")}
        confirmLabel={t("common.delete")}
        busyLabel={t("common.deleting")}
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget)
        }}
      />
    </>
  )
}
