// `trace` widget: code + a step slider + the state after each step. Lines are 1-based, as the
// validator reads them.

import type { TableWidget, TraceWidget } from "@app/domain"
import { useId, useState } from "react"
import { useLesson } from "../context.tsx"
import { RichInline } from "../rich.tsx"

export function TraceView(props: { readonly widget: TraceWidget; readonly label: string }) {
  const w = props.widget
  const { t } = useLesson()
  const [step, setStep] = useState(0)
  const sliderId = useId()
  const lines = w.code.split("\n")
  const total = w.steps.length
  const cur = w.steps[Math.min(step, total - 1)]
  const go = (n: number) => setStep(Math.max(0, Math.min(total - 1, n)))
  return (
    <figure className="lsn-trace" aria-label={props.label}>
      <pre className="lsn-code" data-lang={w.lang}>
        <code>
          {lines.map((l, i) => {
            const on = cur !== undefined && cur.line === i + 1
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: lines of one static string
                key={i}
                className={on ? "lsn-code-line is-run" : "lsn-code-line"}
                aria-current={on ? "step" : undefined}
              >
                <span className="lsn-code-n" aria-hidden>
                  {i + 1}
                </span>
                {l === "" ? " " : l}
              </span>
            )
          })}
        </code>
      </pre>
      {total > 0 && (
        <>
          <div className="lsn-trace-bar">
            <button
              type="button"
              className="lsn-btn"
              aria-label={t("trace.prev")}
              onClick={() => go(step - 1)}
              disabled={step === 0}
            >
              ◀
            </button>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={total - 1}
              step={1}
              value={step}
              aria-label={t("trace.position", { n: step + 1, total })}
              onChange={(e) => go(Number(e.currentTarget.value))}
            />
            <button
              type="button"
              className="lsn-btn"
              aria-label={t("trace.next")}
              onClick={() => go(step + 1)}
              disabled={step >= total - 1}
            >
              ▶
            </button>
            <output htmlFor={sliderId} className="lsn-muted">
              {t("trace.position", { n: step + 1, total })}
            </output>
          </div>
          {cur !== undefined && (
            <div className="lsn-trace-step" aria-live="polite">
              <p>
                <span className="lsn-label">{t("trace.line", { n: cur.line })}</span>{" "}
                <RichInline src={cur.note} />
              </p>
              {Object.keys(cur.state).length > 0 && (
                <table className="lsn-table lsn-trace-state">
                  <caption className="lsn-label">{t("trace.state")}</caption>
                  <tbody>
                    {Object.entries(cur.state).map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">
                          <code>{k}</code>
                        </th>
                        <td>
                          <code>{v}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </figure>
  )
}

export function TableView(props: { readonly widget: TableWidget }) {
  const w = props.widget
  return (
    <div className="lsn-table-wrap">
      <table className="lsn-table">
        <thead>
          <tr>
            {w.head.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              <th key={i} scope="col">
                <RichInline src={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {w.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
            <tr key={r}>
              {row.map((cell, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <td key={c}>
                  <RichInline src={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
