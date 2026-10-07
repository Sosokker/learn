import { useEffect, useRef, useState } from "react"
import { useLesson } from "./context.ts"
import { buildAskPrompt, refChip } from "./refs.ts"
import { useStore } from "./store.ts"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function AskBar({ onAsk }: { readonly onAsk: ((prompt: string) => void) | undefined }) {
  const { refs, slug, spec, concepts, s, uiLang } = useLesson()
  const list = useStore(refs, (v) => v)
  const [question, setQuestion] = useState("")
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const send = async () => {
    const prompt = buildAskPrompt({ question, refs: list, spec, concepts, slug, uiLang })
    onAsk?.(prompt)
    setStatus((await copyText(prompt)) ? "copied" : "failed")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus("idle"), 1800)
  }

  const jump = (key: string) => {
    const el = document.querySelector(`[data-ref="${key.replace(/["\\]/g, "")}"]`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <div className="lx-ask" lang={uiLang}>
      {list.length > 0 ? (
        <div className="lx-ask-chips">
          {list.map((key) => (
            <span key={key} className="lx-ref-chip">
              <button type="button" className="lx-ref-chip-label" onClick={() => jump(key)}>
                {refChip(slug, key)}
              </button>
              <button
                type="button"
                className="lx-ref-chip-x"
                aria-label={`${s.removeRef} ${refChip(slug, key)}`}
                onClick={() => refs.set((r) => r.filter((k) => k !== key))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="lx-ask-hint">{s.askHint}</div>
      )}
      <div className="lx-ask-row">
        <textarea
          className="lx-ask-input"
          rows={1}
          value={question}
          placeholder={s.askPlaceholder}
          aria-label={s.askPlaceholder}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="lx-btn lx-btn-primary" onClick={() => void send()}>
          {status === "copied" ? `✓ ${s.copied}` : status === "failed" ? s.copyFailed : s.copyPrompt}
        </button>
      </div>
      <div className="lx-sr" aria-live="polite">
        {status === "copied" ? s.copied : ""}
      </div>
    </div>
  )
}
