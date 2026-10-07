// Text-like sections: text, problem, chunks, concept, plan, check, story, units.

import type {
  CheckSection,
  ChunksSection,
  ConceptSection,
  PlanSection,
  ProblemSection,
  StorySection,
  TextSection,
  UnitsSection,
} from "@app/domain"
import { RefButton, RoleBadge, SectionFrame } from "../chrome.tsx"
import { useLesson } from "../context.tsx"
import { partsIn } from "../model.ts"
import { Reveal } from "../reveal.tsx"
import { RichBlocks, RichInline } from "../rich.tsx"

const itemAttrs = (section: string, item: string) => ({
  "data-target": `item:${section}.${item}`,
  "data-ref": `item:${section}.${item}`,
})

export function TextView(props: { readonly section: TextSection }) {
  return (
    <SectionFrame section={props.section}>
      <RichBlocks src={props.section.body} />
    </SectionFrame>
  )
}

export function ProblemView(props: { readonly section: ProblemSection }) {
  return (
    <SectionFrame section={props.section}>
      <RichBlocks src={props.section.body} className="lsn-problem" />
    </SectionFrame>
  )
}

export function ChunksView(props: { readonly section: ChunksSection }) {
  const s = props.section
  return (
    <SectionFrame section={s}>
      <ul className="lsn-chunks">
        {s.rows.map((row) => (
          <li key={row.id} className="lsn-item lsn-chunk" {...itemAttrs(s.id, row.id)}>
            <span className="lsn-chunk-text">
              <RichInline src={row.text} />
            </span>
            <RoleBadge role={row.role} part={partsIn([row.text])[0]} />
            <span className="lsn-chunk-note">
              <RichInline src={row.note} />
            </span>
            <RefButton section={s.id} item={row.id} />
          </li>
        ))}
      </ul>
    </SectionFrame>
  )
}

/** A card link showing the card's title (for prerequisite lists). */
export function CardLink(props: { readonly id: string }) {
  const { model } = useLesson()
  const r = model.card(props.id)
  if (r === undefined) return null
  return (
    <button type="button" className="lsn-term" data-target={`card:${props.id}`}>
      <RichInline src={r.card?.title ?? r.conceptSlug ?? props.id} plain />
    </button>
  )
}

export function ConceptView(props: { readonly section: ConceptSection }) {
  const s = props.section
  const { t } = useLesson()
  return (
    <SectionFrame section={s}>
      <dl className="lsn-dl">
        <dt>{t("field.concept")}</dt>
        <dd>
          <RichBlocks src={s.concept} />
        </dd>
        <dt>{t("field.field")}</dt>
        <dd>
          <RichBlocks src={s.field} />
        </dd>
        {s.prerequisites.length > 0 && (
          <>
            <dt>{t("field.prerequisites")}</dt>
            <dd>
              <ul className="lsn-inline-list">
                {s.prerequisites.map((id) => (
                  <li key={id}>
                    <CardLink id={id} />
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </SectionFrame>
  )
}

export function PlanView(props: { readonly section: PlanSection }) {
  const s = props.section
  const { t } = useLesson()
  return (
    <SectionFrame section={s}>
      <div className="lsn-routes">
        {s.routes.map((r) => (
          <article
            key={r.id}
            className={r.picked ? "lsn-item lsn-route is-picked" : "lsn-item lsn-route"}
            {...itemAttrs(s.id, r.id)}
          >
            <header className="lsn-route-head">
              <strong>
                <RichInline src={r.title} />
              </strong>
              <span className="lsn-route-tag">{r.picked ? t("plan.picked") : t("plan.notPicked")}</span>
              <RefButton section={s.id} item={r.id} />
            </header>
            <div className="lsn-route-path">
              <RichInline src={r.path} />
            </div>
            <Reveal id={`${s.id}.${r.id}`} label={t("reveal.why")}>
              <p className="lsn-why">
                <span className="lsn-why-label">{t("field.why")}</span> <RichInline src={r.why} />
              </p>
              <p className="lsn-whynot">
                <span className="lsn-whynot-label">{t("field.whyNot")}</span> <RichInline src={r.whyNot} />
              </p>
            </Reveal>
          </article>
        ))}
      </div>
      {s.notUsed !== undefined && <RichBlocks src={s.notUsed} className="lsn-muted" />}
    </SectionFrame>
  )
}

export function CheckView(props: { readonly section: CheckSection }) {
  const s = props.section
  return (
    <SectionFrame section={s}>
      <ul className="lsn-check">
        {s.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: check items have no ids
          <li key={i}>
            <RichInline src={item} />
          </li>
        ))}
      </ul>
    </SectionFrame>
  )
}

export function StoryView(props: { readonly section: StorySection }) {
  const s = props.section
  return (
    <SectionFrame section={s}>
      <ol className="lsn-story">
        {s.events.map((e) => (
          <li key={e.id} className="lsn-item lsn-event" {...itemAttrs(s.id, e.id)}>
            {e.year !== undefined && <span className="lsn-event-year">{e.year}</span>}
            <span className="lsn-event-text">
              <RichInline src={e.text} />
            </span>
            <RefButton section={s.id} item={e.id} />
          </li>
        ))}
      </ol>
    </SectionFrame>
  )
}

export function UnitsView(props: { readonly section: UnitsSection }) {
  const s = props.section
  const { t, lessonHref } = useLesson()
  return (
    <SectionFrame section={s}>
      <ol className="lsn-units">
        {s.units.map((u, i) => (
          <li key={u.id} className="lsn-item lsn-unit" {...itemAttrs(s.id, u.id)}>
            <span className="lsn-unit-n">{i + 1}</span>
            <div className="lsn-unit-body">
              <div className="lsn-unit-title">
                <RichInline src={u.title} />
              </div>
              <div className="lsn-muted">
                <RichInline src={u.milestone} />
              </div>
              {u.lessonSlug !== undefined && lessonHref !== undefined && (
                <a className="lsn-link" href={lessonHref(u.lessonSlug)}>
                  {t("units.open")}
                </a>
              )}
            </div>
            <RefButton section={s.id} item={u.id} />
          </li>
        ))}
      </ol>
    </SectionFrame>
  )
}
