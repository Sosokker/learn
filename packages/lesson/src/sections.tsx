import { richToPlain, type Section } from "@app/domain"
import { lazy, Suspense, useContext, useMemo, useState } from "react"
import { resolveTarget } from "./cards.ts"
import { LinkScopeContext, useLesson } from "./context.ts"
import { Reveal, useHidden } from "./reveal.tsx"
import { Rich, Tex } from "./rich.tsx"
import { Incline, Plot, Table, Trace } from "./widgets.tsx"

const GraphCanvas = lazy(() => import("./diagram.tsx").then((m) => ({ default: m.GraphCanvas })))
const FlowCanvas = lazy(() => import("./diagram.tsx").then((m) => ({ default: m.FlowCanvas })))

type Of<T extends Section["type"]> = Extract<Section, { type: T }>

function DiagramFallback() {
  const { s } = useLesson()
  return <div className="lx-diagram lx-diagram-loading">{s.loading}</div>
}

function TextSectionView({ sec }: { readonly sec: Of<"text"> }) {
  return <Rich src={sec.body} />
}

function ProblemSectionView({ sec }: { readonly sec: Of<"problem"> }) {
  return (
    <div className="lx-problem">
      <Rich src={sec.body} />
    </div>
  )
}

function RoleBadge({ role }: { readonly role: Of<"chunks">["rows"][number]["role"] }) {
  const { s, uiLang } = useLesson()
  return (
    <span className={`lx-role lx-role-${role}`} lang={uiLang}>
      {s.roles[role]}
    </span>
  )
}

function ChunksView({ sec }: { readonly sec: Of<"chunks"> }) {
  return (
    <div className="lx-chunks">
      {sec.rows.map((r) => (
        <div key={r.id} className="lx-chunk" data-ref={`${sec.id}.${r.id}`}>
          <div className="lx-chunk-text">
            <Rich src={r.text} inline />
          </div>
          <RoleBadge role={r.role} />
          <div className="lx-chunk-note">
            <Rich src={r.note} inline />
          </div>
        </div>
      ))}
    </div>
  )
}

function ConceptView({ sec }: { readonly sec: Of<"concept"> }) {
  const { s, uiLang } = useLesson()
  return (
    <div className="lx-concept">
      <div className="lx-kv">
        <div className="lx-kv-key" lang={uiLang}>
          {s.concept}
        </div>
        <Rich src={sec.concept} />
        <div className="lx-kv-key" lang={uiLang}>
          {s.field}
        </div>
        <Rich src={sec.field} />
      </div>
      {sec.prerequisites.length > 0 ? (
        <div className="lx-chips">
          <span className="lx-chips-label" lang={uiLang}>
            {s.prerequisites}
          </span>
          {sec.prerequisites.map((id) => (
            <PrereqChip key={id} id={id} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PrereqChip({ id }: { readonly id: string }) {
  const { spec, concepts } = useLesson()
  const scope = useContext(LinkScopeContext)
  const r = useMemo(() => resolveTarget({ k: "card", id }, spec, concepts), [id, spec, concepts])
  const title = r.k === "card" || r.k === "concept" ? r.card.title : id
  return (
    <button
      type="button"
      className={r.k === "concept" ? "lx-chip lx-chip-card is-shared" : "lx-chip lx-chip-card"}
      data-card={id}
      onPointerEnter={() => scope.preview({ k: "card", id })}
      onPointerLeave={() => scope.preview(null)}
      onClick={(e) => {
        if (!e.altKey) scope.open({ k: "card", id })
      }}
    >
      {r.k === "concept" ? <span className="lx-shared-dot" aria-hidden="true" /> : null}
      <Rich src={title} inline />
    </button>
  )
}

function PlanRoute({ sid, r }: { readonly sid: string; readonly r: Of<"plan">["routes"][number] }) {
  const { s, uiLang } = useLesson()
  const id = `${sid}.${r.id}`
  const [hidden] = useHidden(id)
  const cls = ["lx-route", !hidden && r.picked ? "is-picked" : "", !hidden && !r.picked ? "is-rejected" : ""]
  return (
    <div className={cls.join(" ")} data-ref={id}>
      <div className="lx-route-head">
        <span className="lx-route-title">
          <Rich src={r.title} inline />
        </span>
        {hidden ? null : (
          <span className={r.picked ? "lx-badge lx-badge-primary" : "lx-badge"} lang={uiLang}>
            {r.picked ? s.picked : s.notPicked}
          </span>
        )}
      </div>
      <div className="lx-route-path">
        <Rich src={r.path} inline />
      </div>
      <Reveal id={id}>
        <dl className="lx-why">
          <dt lang={uiLang}>{s.why}</dt>
          <dd>
            <Rich src={r.why} inline />
          </dd>
          <dt lang={uiLang}>{s.whyNot}</dt>
          <dd>
            <Rich src={r.whyNot} inline />
          </dd>
        </dl>
      </Reveal>
    </div>
  )
}

function PlanView({ sec }: { readonly sec: Of<"plan"> }) {
  const { s, uiLang } = useLesson()
  return (
    <div className="lx-plan">
      <div className="lx-routes">
        {sec.routes.map((r) => (
          <PlanRoute key={r.id} sid={sec.id} r={r} />
        ))}
      </div>
      {sec.notUsed === undefined ? null : (
        <div className="lx-notused">
          <span className="lx-kv-key" lang={uiLang}>
            {s.notUsed}
          </span>
          <Rich src={sec.notUsed} inline />
        </div>
      )}
    </div>
  )
}

function UsesChips({ ids }: { readonly ids: ReadonlyArray<string> }) {
  const { spec, s, uiLang } = useLesson()
  if (ids.length === 0) return null
  return (
    <div className="lx-uses">
      <span className="lx-uses-label" lang={uiLang}>
        {s.uses}
      </span>
      {ids.map((id) => {
        const p = Object.hasOwn(spec.parts, id) ? spec.parts[id] : undefined
        return (
          <span key={id} className="lx-use" data-part={id}>
            <Rich src={p?.label ?? id} inline />
          </span>
        )
      })}
    </div>
  )
}

function ChainView({ sec }: { readonly sec: Of<"chain"> }) {
  const { s, uiLang } = useLesson()
  return (
    <ol className="lx-chain">
      {sec.steps.map((st, i) => {
        const ref = `${sec.id}.${st.id}`
        return (
          <li key={st.id} className="lx-step" data-ref={ref} data-lit={st.uses.join(" ")}>
            <div className="lx-step-num" aria-hidden="true">
              {i + 1}
            </div>
            <div className="lx-step-main">
              <div className="lx-step-move">
                <Rich src={st.move} inline />
              </div>
              {st.formula === undefined ? null : (
                <Reveal id={`${ref}.formula`}>
                  <div className="lx-step-formula">
                    <Tex tex={st.formula} display />
                  </div>
                </Reveal>
              )}
              <Reveal id={`${ref}.why`}>
                <dl className="lx-why">
                  <dt lang={uiLang}>{s.why}</dt>
                  <dd>
                    <Rich src={st.why} inline />
                  </dd>
                  {st.whyNot === undefined ? null : (
                    <>
                      <dt lang={uiLang}>{s.whyNot}</dt>
                      <dd>
                        <Rich src={st.whyNot} inline />
                      </dd>
                    </>
                  )}
                </dl>
              </Reveal>
              <UsesChips ids={st.uses} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ProofView({ sec }: { readonly sec: Of<"proof"> }) {
  const { s, uiLang } = useLesson()
  const [hot, setHot] = useState<string | null>(null)
  const num = useMemo(() => new Map(sec.lines.map((l, i) => [l.id, i + 1])), [sec.lines])
  const deps = new Set(hot === null ? [] : (sec.lines.find((l) => l.id === hot)?.deps ?? []))
  return (
    <div className="lx-proof">
      <div className="lx-proof-goal">
        <span className="lx-kv-key" lang={uiLang}>
          {s.goal}
        </span>
        <Rich src={sec.goal} inline />
      </div>
      <ol className={hot === null ? "lx-proof-lines" : "lx-proof-lines has-hot"}>
        {sec.lines.map((l, i) => {
          const ref = `${sec.id}.${l.id}`
          const state = l.id === hot ? "is-src" : deps.has(l.id) ? "is-dep" : ""
          return (
            <li
              key={l.id}
              className={`lx-pline ${state}`}
              data-ref={ref}
              onPointerEnter={() => setHot(l.id)}
              onPointerLeave={() => setHot((h) => (h === l.id ? null : h))}
            >
              <div className="lx-pline-num">({i + 1})</div>
              <div className="lx-pline-main">
                <div className="lx-pline-claim">
                  <Rich src={l.claim} inline />
                </div>
                <Reveal id={`${ref}.why`}>
                  <dl className="lx-why">
                    <dt lang={uiLang}>{s.why}</dt>
                    <dd>
                      <Rich src={l.why} inline />
                    </dd>
                    {l.intuition === undefined ? null : (
                      <>
                        <dt lang={uiLang}>{s.intuition}</dt>
                        <dd>
                          <Rich src={l.intuition} inline />
                        </dd>
                      </>
                    )}
                    {l.whyNot === undefined ? null : (
                      <>
                        <dt lang={uiLang}>{s.whyNot}</dt>
                        <dd>
                          <Rich src={l.whyNot} inline />
                        </dd>
                      </>
                    )}
                  </dl>
                </Reveal>
              </div>
              {l.deps.length > 0 ? (
                <div className="lx-pline-deps" lang={uiLang}>
                  {s.uses} {l.deps.map((d) => `(${num.get(d) ?? d})`).join(" ")}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function GraphView({ sec }: { readonly sec: Of<"graph"> }) {
  const { s } = useLesson()
  const scope = useContext(LinkScopeContext)
  return (
    <Suspense fallback={<DiagramFallback />}>
      <GraphCanvas section={sec} kindLabels={s.nodeKinds} onOpen={scope.open} />
    </Suspense>
  )
}

function VisualView({ sec }: { readonly sec: Of<"visual"> }) {
  const scope = useContext(LinkScopeContext)
  const w = sec.widget
  switch (w.kind) {
    case "plot":
      return <Plot w={w} />
    case "table":
      return <Table w={w} />
    case "incline":
      return <Incline w={w} />
    case "trace":
      return <Trace w={w} />
    case "flow":
      return (
        <Suspense fallback={<DiagramFallback />}>
          <FlowCanvas widget={w} sectionId={sec.id} onOpen={scope.open} plain={richToPlain} />
        </Suspense>
      )
  }
}

function CheckView({ sec }: { readonly sec: Of<"check"> }) {
  return (
    <ul className="lx-check">
      {sec.items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: check items have no ids
        <li key={i}>
          <span className="lx-check-mark" aria-hidden="true" />
          <Rich src={it} inline />
        </li>
      ))}
    </ul>
  )
}

function StoryView({ sec }: { readonly sec: Of<"story"> }) {
  return (
    <ol className="lx-story">
      {sec.events.map((e) => (
        <li key={e.id} data-ref={`${sec.id}.${e.id}`}>
          <span className="lx-story-year">{e.year ?? ""}</span>
          <span className="lx-story-dot" aria-hidden="true" />
          <div className="lx-story-text">
            <Rich src={e.text} inline />
          </div>
        </li>
      ))}
    </ol>
  )
}

function UnitsView({ sec }: { readonly sec: Of<"units"> }) {
  const { s, uiLang } = useLesson()
  return (
    <ol className="lx-units">
      {sec.units.map((u, i) => (
        <li key={u.id} data-ref={`${sec.id}.${u.id}`}>
          <span className="lx-unit-num">{i + 1}</span>
          <div>
            <div className="lx-unit-title">
              <Rich src={u.title} inline />
            </div>
            <div className="lx-unit-milestone">
              <Rich src={u.milestone} inline />
            </div>
            {u.lessonSlug === undefined ? null : (
              <div className="lx-unit-lesson" lang={uiLang}>
                {s.openLesson} <code className="lx-code">{u.lessonSlug}</code>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RecallQuestion({ sid, q, n }: { sid: string; q: Of<"recall">["questions"][number]; n: number }) {
  const { s, uiLang } = useLesson()
  const [picked, setPicked] = useState<number | null>(null)
  const ref = `${sid}.${q.id}`
  return (
    <li className="lx-recall-q" data-ref={ref}>
      <div className="lx-recall-prompt">
        <span className="lx-recall-n">{n}</span>
        <Rich src={q.q} inline />
      </div>
      <div className="lx-options">
        {q.options.map((o, i) => {
          const state =
            picked === null ? "" : i === q.answer ? "is-correct" : i === picked ? "is-wrong" : "is-muted"
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
              key={i}
              type="button"
              className={`lx-option ${state}`}
              aria-pressed={picked === i}
              onClick={(e) => {
                if (!e.altKey) setPicked(i)
              }}
            >
              <span className="lx-option-letter">{String.fromCharCode(65 + i)}</span>
              <Rich src={o} inline />
            </button>
          )
        })}
      </div>
      {picked === null ? null : (
        <div className="lx-recall-result">
          <span
            className={picked === q.answer ? "lx-badge lx-badge-ok" : "lx-badge lx-badge-bad"}
            lang={uiLang}
          >
            {picked === q.answer ? s.correct : s.notQuite}
          </span>
          <Reveal id={`${ref}.why`}>
            <div className="lx-recall-why">
              <Rich src={q.why} inline />
            </div>
          </Reveal>
        </div>
      )}
    </li>
  )
}

function RecallView({ sec }: { readonly sec: Of<"recall"> }) {
  return (
    <ol className="lx-recall">
      {sec.questions.map((q, i) => (
        <RecallQuestion key={q.id} sid={sec.id} q={q} n={i + 1} />
      ))}
    </ol>
  )
}

function SectionBody({ sec }: { readonly sec: Section }) {
  switch (sec.type) {
    case "text":
      return <TextSectionView sec={sec} />
    case "problem":
      return <ProblemSectionView sec={sec} />
    case "chunks":
      return <ChunksView sec={sec} />
    case "concept":
      return <ConceptView sec={sec} />
    case "plan":
      return <PlanView sec={sec} />
    case "chain":
      return <ChainView sec={sec} />
    case "proof":
      return <ProofView sec={sec} />
    case "graph":
      return <GraphView sec={sec} />
    case "visual":
      return <VisualView sec={sec} />
    case "check":
      return <CheckView sec={sec} />
    case "story":
      return <StoryView sec={sec} />
    case "units":
      return <UnitsView sec={sec} />
    case "recall":
      return <RecallView sec={sec} />
  }
}

export const sectionAnchor = (id: string) => `lx-${id}`

export function SectionView({ sec }: { readonly sec: Section }) {
  const { s, uiLang } = useLesson()
  return (
    <section className={`lx-section lx-section-${sec.type}`} id={sectionAnchor(sec.id)} data-ref={sec.id}>
      <header className="lx-section-head">
        <span className="lx-eyebrow" lang={uiLang}>
          {s.sectionTypes[sec.type] ?? sec.type}
        </span>
        {sec.title === undefined ? null : <h2 className="lx-section-title">{sec.title}</h2>}
        {sec.note === undefined ? null : <p className="lx-section-note">{sec.note}</p>}
      </header>
      <SectionBody sec={sec} />
    </section>
  )
}
