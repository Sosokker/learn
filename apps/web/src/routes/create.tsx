import { Button, buttonClass, Card, ChevronDownIcon, cx, EmptyState, useI18n } from "@app/ui"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { signInWithGoogle } from "../auth.ts"
import { SparkIcon } from "../icons.tsx"
import { PageSpinner } from "../lesson-view.tsx"
import { useViewer } from "../session.ts"
import { UploadForm } from "../upload-panel.tsx"

export const Route = createFileRoute("/create")({ component: CreatePage })

// The harnesses Learn can write a skill into. `init` creates the file and, for Codex and pi, adds
// a short pointer to AGENTS.md. The paths are the harnesses' project-level conventions.
const harnesses = [
  { id: "claude", label: "agent.harness.claude", path: ".claude/skills/learn/SKILL.md" },
  { id: "opencode", label: "agent.harness.opencode", path: ".opencode/skills/learn/SKILL.md" },
  { id: "codex", label: "agent.harness.codex", path: ".learn/SKILL.md" },
  { id: "pi", label: "agent.harness.pi", path: ".learn/SKILL.md" },
  { id: "generic", label: "agent.harness.generic", path: ".learn/SKILL.md" },
] as const

type Harness = (typeof harnesses)[number]

function CreatePage() {
  const { t } = useI18n()
  const viewer = useViewer()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("agent.title")}</h1>
        <p className="text-body-sm text-ink-subtle">{t("agent.description")}</p>
      </header>
      {viewer.pending ? (
        <PageSpinner />
      ) : viewer.user === null ? (
        <EmptyState
          icon={<SparkIcon />}
          title={t("agent.signIn.title")}
          description={t("agent.signIn.description")}
          action={
            <Button variant="primary" onClick={() => void signInWithGoogle().catch(() => undefined)}>
              {t("auth.signInWithGoogle")}
            </Button>
          }
        />
      ) : (
        <Setup />
      )}
    </div>
  )
}

function Setup() {
  const { t } = useI18n()
  const origin = window.location.origin
  const [harness, setHarness] = useState<Harness>(harnesses[0])
  const urlFlag = origin === "https://learn.sirin.dev" ? "" : ` --url ${origin}`
  const install = [
    `curl -fsSL ${origin}/agent/learn.mjs -o learn.mjs`,
    `node learn.mjs init ${harness.id}${urlFlag}`,
  ].join("\n")
  const token = "export LEARN_TOKEN=lrn_…"

  return (
    <>
      <Card>
        <h2 className="text-body font-semibold text-ink">{t("agent.step.token.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.step.token.body")}</p>
        <Link to="/settings" className={cx(buttonClass("secondary", "sm"), "self-start")}>
          {t("agent.step.token.action")}
        </Link>
      </Card>

      <Card>
        <h2 className="text-body font-semibold text-ink">{t("agent.step.install.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.step.install.body")}</p>
        <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="sr-only">{t("agent.step.install.harness")}</legend>
          {harnesses.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === harness.id}
              onClick={() => setHarness(item)}
              className={cx(
                buttonClass("secondary", "sm"),
                item.id === harness.id && "border-accent text-ink",
              )}
            >
              {t(item.label)}
            </button>
          ))}
        </fieldset>
        <CodeBlock
          text={install}
          copy={t("agent.copy")}
          copied={t("agent.copied")}
          failed={t("agent.copyFailed")}
        />
        <p className="text-caption text-ink-subtle">{t("agent.step.install.hint", { path: harness.path })}</p>
      </Card>

      <Card>
        <h2 className="text-body font-semibold text-ink">{t("agent.step.export.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.step.export.body")}</p>
        <CodeBlock
          text={token}
          copy={t("agent.copy")}
          copied={t("agent.copied")}
          failed={t("agent.copyFailed")}
        />
      </Card>

      <Card>
        <h2 className="text-body font-semibold text-ink">{t("agent.step.ask.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.step.ask.body")}</p>
        <CodeBlock
          text={t("agent.step.ask.prompt")}
          copy={t("agent.copy")}
          copied={t("agent.copied")}
          failed={t("agent.copyFailed")}
          wrap
        />
      </Card>

      <Card>
        <h2 className="text-body font-semibold text-ink">{t("agent.step.preview.title")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.step.preview.body")}</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/library" className={buttonClass("secondary", "sm")}>
            {t("agent.step.preview.action")}
          </Link>
          <Link to="/guide" className={buttonClass("ghost", "sm")}>
            {t("agent.learnMore")}
          </Link>
        </div>
      </Card>

      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="flex flex-col gap-1">
              <h2 className="text-body font-semibold text-ink">{t("upload.title")}</h2>
              <span className="text-body-sm text-ink-subtle">{t("upload.description")}</span>
            </span>
            <span
              aria-hidden
              className="mt-1 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
            >
              <ChevronDownIcon />
            </span>
          </summary>
          <div className="group-open:mt-4">
            <UploadForm />
          </div>
        </details>
      </Card>

      <div className="flex flex-col gap-1">
        <h2 className="text-body-sm font-medium text-ink-muted">{t("agent.howItWorks")}</h2>
        <p className="text-body-sm text-ink-subtle">{t("agent.howItWorks.body")}</p>
      </div>
    </>
  )
}

function CodeBlock(props: {
  readonly text: string
  readonly copy: string
  readonly copied: string
  readonly failed: string
  readonly wrap?: boolean
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = () => {
    navigator.clipboard.writeText(props.text).then(
      () => setState("copied"),
      () => setState("failed"),
    )
  }
  return (
    <div className="relative">
      <pre
        className={cx(
          "rounded-md border border-hairline bg-surface-2 p-3 pr-24 font-mono text-caption leading-relaxed text-ink-muted",
          props.wrap === true ? "whitespace-pre-wrap break-words" : "overflow-x-auto",
        )}
      >
        <code>{props.text}</code>
      </pre>
      <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={copy}>
        {state === "copied" ? props.copied : state === "failed" ? props.failed : props.copy}
      </Button>
    </div>
  )
}
