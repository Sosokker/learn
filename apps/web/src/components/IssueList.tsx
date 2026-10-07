import { AlertIcon, useT } from "@app/ui"
import type { Issue } from "../lib/api.ts"

const maxShown = 30

// A union mismatch lists every member's shape; the start says enough.
const shorten = (message: string) => (message.length > 160 ? `${message.slice(0, 157)}…` : message)

// Schema or server issues as "path — message" lines, the path in mono so it can be found in the file.
export function IssueList({ title, issues }: { title: string; issues: ReadonlyArray<Issue> }) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3">
      <p className="flex items-center gap-2 text-dense font-medium text-ink">
        <AlertIcon className="shrink-0 text-danger" />
        {title}
      </p>
      {issues.length > 0 ? (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {issues.slice(0, maxShown).map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: issues can repeat a path
            <li key={i} className="flex flex-col gap-0.5 text-caption">
              <code className="font-mono break-all text-ink-muted">{issue.path || t("upload.root")}</code>
              <span className="text-ink-subtle">{shorten(issue.message)}</span>
            </li>
          ))}
          {issues.length > maxShown ? (
            <li className="text-caption text-ink-tertiary">+{issues.length - maxShown}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

// Standard Schema paths hold keys or { key } segments.
export function formatPath(path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>): string {
  let out = ""
  for (const segment of path) {
    const key = typeof segment === "object" ? segment.key : segment
    if (typeof key === "number") out += `[${key}]`
    else out += out ? `.${String(key)}` : String(key)
  }
  return out
}
