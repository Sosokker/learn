// The ask bar: a question plus `@ref` chips. Typing `@` lists every referenceable piece; Alt-click
// or `@` while hovering adds one. "Copy prompt for pi" copies the question and the referenced
// pieces as clean TeX (and hands it to `onAskPrompt` when the host app wants it).

import { useId, useMemo, useState } from "react"
import { useLesson } from "./context.tsx"
import { plainTitle, referenceableTargets, type Target, targetKey } from "./model.ts"
import { buildPrompt, refName } from "./refs.ts"
import { TargetTitle } from "./rich.tsx"

export interface AskPayload {
  readonly question: string
  readonly refs: ReadonlyArray<string>
  readonly prompt: string
}

export function AskBar(props: {
  readonly refs: ReadonlyArray<Target>
  readonly onRemove: (index: number) => void
  readonly onAdd: (t: Target) => void
  readonly onAsk: ((payload: AskPayload) => void) | undefined
}) {
  const { model, t, actions } = useLesson()
  const [question, setQuestion] = useState("")
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const inputId = useId()
  const all = useMemo(
    () =>
      referenceableTargets(model).map((x) => ({
        target: x,
        name: refName(model, x),
        title: plainTitle(model, x),
      })),
    [model],
  )
  const at = /@([\w./:-]*)$/.exec(question)
  const query = at?.[1]?.toLowerCase()
  const suggestions =
    query === undefined
      ? []
      : all.filter((s) => `${s.name} ${s.title}`.toLowerCase().includes(query)).slice(0, 9)
  const open = query !== undefined

  const pick = (i: number) => {
    const s = suggestions[i]
    if (s === undefined) return
    props.onAdd(s.target)
    setQuestion((q) => q.replace(/@([\w./:-]*)$/, ""))
    setSelected(0)
  }

  const send = () => {
    const prompt = buildPrompt(model, question, props.refs, t)
    actions.copy(prompt, t("ask.copied"))
    props.onAsk?.({ question: question.trim(), refs: props.refs.map((r) => refName(model, r)), prompt })
  }

  return (
    <div className="lsn-ask">
      <span className="lsn-ask-prompt" aria-hidden>
        ›
      </span>
      {props.refs.length > 0 && (
        <ul className="lsn-chips">
          {props.refs.map((r, i) => {
            const name = refName(model, r)
            return (
              <li key={targetKey(r)} className="lsn-chip" title={plainTitle(model, r, 80)}>
                <span>{name}</span>
                <button
                  type="button"
                  className="lsn-chip-x"
                  aria-label={t("ask.remove", { name })}
                  onClick={() => props.onRemove(i)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="lsn-ask-field">
        <label htmlFor={inputId} className="lsn-sr-only">
          {t("ask.label")}
        </label>
        <input
          id={inputId}
          className="lsn-ask-input"
          autoComplete="off"
          placeholder={t("ask.placeholder")}
          value={question}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions.length > 0 ? `${listId}-${selected}` : undefined}
          onChange={(e) => {
            setQuestion(e.currentTarget.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (open && suggestions.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSelected((s) => (s + 1) % suggestions.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setSelected((s) => (s - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                pick(selected)
                return
              }
            }
            if (e.key === "Escape" && open) {
              e.preventDefault()
              setQuestion((q) => q.replace(/@([\w./:-]*)$/, ""))
              return
            }
            if (e.key === "Enter") {
              e.preventDefault()
              send()
              return
            }
            if (e.key === "Backspace" && question === "" && props.refs.length > 0) {
              props.onRemove(props.refs.length - 1)
            }
          }}
        />
        {open && (
          <div className="lsn-suggest" id={listId} role="listbox" aria-label={t("ask.suggestions")}>
            {suggestions.length === 0 ? (
              <div className="lsn-muted">{t("ask.noMatch")}</div>
            ) : (
              suggestions.map((s, i) => (
                <div
                  key={targetKey(s.target)}
                  id={`${listId}-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === selected}
                  className={i === selected ? "is-selected" : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(i)
                  }}
                >
                  <span className="lsn-suggest-name">{s.name}</span>
                  <span className="lsn-muted lsn-suggest-title">
                    <TargetTitle target={s.target} />
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <button type="button" className="lsn-btn lsn-btn-primary" onClick={send}>
        {t("ask.copy")}
      </button>
    </div>
  )
}
