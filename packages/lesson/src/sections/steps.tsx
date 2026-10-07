// Chain (steps with why / why not), proof (lines with deps) and recall (quiz).

import type { ChainSection, ProofSection, RecallSection } from "@app/domain"
import { useState } from "react"
import { RefButton, SectionFrame } from "../chrome.tsx"
import { useLesson, useMode } from "../context.tsx"
import { Reveal, RevealControls } from "../reveal.tsx"
import { RichInline, Tex } from "../rich.tsx"

const itemAttrs = (section: string, item: string) => ({
  "data-target": `item:${section}.${item}`,
  "data-ref": `item:${section}.${item}`,
})

export function ChainView(props: { readonly section: ChainSection }) {
  const s = props.section
  const { t } = useLesson()
  const revealIds = s.steps.map((step) => `${s.id}.${step.id}`)
  return (
    <SectionFrame section={s} actions={<RevealControls ids={revealIds} />}>
      <ol className="lsn-chain">
        {s.steps.map((step, i) => (
          <li
            key={step.id}
            className="lsn-item lsn-step"
            {...itemAttrs(s.id, step.id)}
            aria-label={t("chain.step", { n: i + 1 })}
          >
            <span className="lsn-step-n" aria-hidden>
              {i + 1}
            </span>
            <div className="lsn-step-body">
              <div className="lsn-step-head">
                <span className="lsn-step-move">
                  <RichInline src={step.move} />
                </span>
                <RefButton section={s.id} item={step.id} />
              </div>
              <Reveal id={`${s.id}.${step.id}`}>
                {step.formula !== undefined && (
                  <div className="lsn-fx">
                    <Tex tex={step.formula} display />
                  </div>
                )}
                <p className="lsn-why">
                  <span className="lsn-why-label">{t("field.why")}</span> <RichInline src={step.why} />
                </p>
                {step.whyNot !== undefined && (
                  <p className="lsn-whynot">
                    <span className="lsn-whynot-label">{t("field.whyNot")}</span>{" "}
                    <RichInline src={step.whyNot} />
                  </p>
                )}
              </Reveal>
            </div>
          </li>
        ))}
      </ol>
    </SectionFrame>
  )
}

export function ProofView(props: { readonly section: ProofSection }) {
  const s = props.section
  const { t } = useLesson()
  const revealIds = s.lines.map((l) => `${s.id}.${l.id}`)
  return (
    <SectionFrame section={s} actions={<RevealControls ids={revealIds} />}>
      <p className="lsn-proof-goal">
        <span className="lsn-label">{t("field.goal")}</span> <RichInline src={s.goal} />
      </p>
      <ol className="lsn-proof">
        {s.lines.map((line, i) => (
          <li key={line.id} className="lsn-item lsn-line" {...itemAttrs(s.id, line.id)}>
            <span className="lsn-line-n">{i + 1}</span>
            <div className="lsn-line-claim">
              <RichInline src={line.claim} />
            </div>
            <div className="lsn-line-why">
              <Reveal id={`${s.id}.${line.id}`} label={t("reveal.why")}>
                <p className="lsn-why">
                  <span className="lsn-why-label">{t("field.why")}</span> <RichInline src={line.why} />
                </p>
                {line.intuition !== undefined && (
                  <p className="lsn-intuition">
                    <span className="lsn-label">{t("field.intuition")}</span>{" "}
                    <RichInline src={line.intuition} />
                  </p>
                )}
                {line.whyNot !== undefined && (
                  <p className="lsn-whynot">
                    <span className="lsn-whynot-label">{t("field.whyNot")}</span>{" "}
                    <RichInline src={line.whyNot} />
                  </p>
                )}
              </Reveal>
            </div>
            <RefButton section={s.id} item={line.id} />
          </li>
        ))}
      </ol>
    </SectionFrame>
  )
}

export function RecallView(props: { readonly section: RecallSection }) {
  const s = props.section
  const { t } = useLesson()
  const { mode } = useMode()
  const [picked, setPicked] = useState<Readonly<Record<string, number>>>({})
  const [shown, setShown] = useState(false)
  return (
    <SectionFrame
      section={s}
      actions={
        mode === "show" && !shown ? (
          <button type="button" className="lsn-btn lsn-btn-ghost" onClick={() => setShown(true)}>
            {t("recall.showAnswers")}
          </button>
        ) : null
      }
    >
      <ol className="lsn-quiz">
        {s.questions.map((q, qi) => {
          const choice = picked[q.id]
          const answered = choice !== undefined || shown
          return (
            <li key={q.id} className="lsn-item lsn-question" {...itemAttrs(s.id, q.id)}>
              <div className="lsn-question-head">
                <span className="lsn-question-q">
                  {qi + 1}. <RichInline src={q.q} />
                </span>
                <RefButton section={s.id} item={q.id} />
              </div>
              <div className="lsn-options">
                {q.options.map((o, oi) => {
                  const state = !answered
                    ? ""
                    : oi === q.answer
                      ? "is-right"
                      : oi === choice
                        ? "is-wrong"
                        : ""
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
                      key={oi}
                      type="button"
                      className={`lsn-option ${state}`}
                      aria-pressed={choice === oi}
                      onClick={() => setPicked((p) => ({ ...p, [q.id]: oi }))}
                    >
                      <RichInline src={o} plain />
                    </button>
                  )
                })}
              </div>
              <p className="lsn-feedback" aria-live="polite">
                {answered && (
                  <>
                    {choice !== undefined && (
                      <span className={choice === q.answer ? "lsn-good" : "lsn-bad"}>
                        {choice === q.answer ? t("recall.right") : t("recall.wrong")}
                      </span>
                    )}{" "}
                    <RichInline src={q.why} />
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ol>
    </SectionFrame>
  )
}
