import type { LessonKind, LessonSummary, Visibility } from "@app/domain"
import {
  Badge,
  Chip,
  CodeIcon,
  ForkIcon,
  GlobeIcon,
  GuideIcon,
  HeartIcon,
  LearnIcon,
  LinkIcon,
  LockIcon,
  ProofIcon,
  SituationIcon,
  SolveIcon,
  useI18n,
} from "@app/ui"
import { Link } from "@tanstack/react-router"
import type { ComponentProps, ReactNode } from "react"

const kindIcons: Record<LessonKind, (p: ComponentProps<"svg">) => ReactNode> = {
  solve: SolveIcon,
  learn: LearnIcon,
  situation: SituationIcon,
  code: CodeIcon,
  proof: ProofIcon,
  guide: GuideIcon,
}

export function KindIcon({ kind, className }: { kind: LessonKind; className?: string }) {
  const Icon = kindIcons[kind]
  return <Icon className={className} />
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const { t } = useI18n()
  const icon =
    visibility === "public" ? (
      <GlobeIcon className="size-3" />
    ) : visibility === "unlisted" ? (
      <LinkIcon className="size-3" />
    ) : (
      <LockIcon className="size-3" />
    )
  return (
    <Badge tone={visibility === "public" ? "accent" : "neutral"} icon={icon}>
      {t(`visibility.${visibility}`)}
    </Badge>
  )
}

export interface LessonRowProps {
  lesson: LessonSummary
  // Library rows: visibility instead of the author, plus an actions menu.
  owned?: boolean
  actions?: ReactNode
  meta?: ReactNode
}

// A Linear issue row: kind icon · title · tags · author · likes · forks · date. The title link
// stretches over the whole row, and `actions` sit above it so they stay clickable.
export function LessonRow({ lesson, owned = false, actions, meta }: LessonRowProps) {
  const { t, lang, formatRelative, formatNumber } = useI18n()
  const date = lesson.publishedAt ?? lesson.updatedAt
  return (
    <div className="group relative flex h-11 items-center gap-3 border-b border-hairline px-6 transition-colors duration-100 hover:bg-surface-1 max-md:h-auto max-md:min-h-[60px] max-md:items-start max-md:px-4 max-md:py-2.5">
      <span className="flex shrink-0 text-ink-subtle max-md:pt-0.5" title={t(`kind.${lesson.kind}`)}>
        <KindIcon kind={lesson.kind} />
        <span className="sr-only">{t(`kind.${lesson.kind}`)}</span>
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-3 max-md:flex-col max-md:items-start max-md:gap-1">
        <div className="flex min-w-0 items-baseline gap-2 md:flex-1">
          <Link
            to="/@{$handle}/$slug"
            params={{ handle: lesson.owner.handle, slug: lesson.slug }}
            className="min-w-0 max-w-[70%] shrink-0 truncate text-dense font-medium text-ink outline-none max-md:max-w-none max-md:shrink after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary-focus/50 max-md:whitespace-normal max-md:line-clamp-2"
            lang={lesson.lang}
          >
            {lesson.title}
          </Link>
          <span
            className="hidden min-w-0 flex-1 truncate text-dense text-ink-tertiary lg:block"
            lang={lesson.lang}
          >
            {lesson.summary}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-caption text-ink-subtle max-md:flex-wrap max-md:gap-x-2.5 max-md:gap-y-1">
          {meta}
          {lesson.tags.length > 0 ? (
            <span className="flex items-center gap-1 max-md:hidden">
              {lesson.tags.slice(0, 3).map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </span>
          ) : null}
          {lesson.langs.length > 1 ? (
            <span
              className="font-mono text-ink-tertiary uppercase"
              title={t("row.languages", { langs: lesson.langs.map((l) => t(`lessonLang.${l}`)).join(", ") })}
            >
              {lesson.langs.join("·")}
            </span>
          ) : null}
          {owned ? (
            <VisibilityBadge visibility={lesson.visibility} />
          ) : (
            <span className="max-w-32 truncate">@{lesson.owner.handle}</span>
          )}
          <span
            className="flex w-9 items-center gap-1 tabular-nums"
            title={t("row.likes", { n: lesson.likeCount })}
          >
            <HeartIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t("row.likes", { n: lesson.likeCount })}</span>
            <span aria-hidden="true">{formatNumber(lesson.likeCount)}</span>
          </span>
          <span
            className="flex w-9 items-center gap-1 tabular-nums"
            title={t("row.forks", { n: lesson.forkCount })}
          >
            <ForkIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t("row.forks", { n: lesson.forkCount })}</span>
            <span aria-hidden="true">{formatNumber(lesson.forkCount)}</span>
          </span>
          <time
            className="w-20 truncate text-right text-ink-tertiary max-md:w-auto max-md:text-left"
            dateTime={new Date(date).toISOString()}
            lang={lang}
          >
            {formatRelative(date)}
          </time>
        </div>
      </div>
      {actions ? <div className="relative z-10 -my-1 flex shrink-0 items-center">{actions}</div> : null}
    </div>
  )
}
