// `plot` widget: plain SVG, curves from the safe expression compiler, sliders for params,
// points and live readouts. Every mark bound to a part joins the linked highlight.

import type { PlotWidget } from "@app/domain"
import { useId, useMemo, useState } from "react"
import { useLesson } from "../context.tsx"
import { richText } from "../model.ts"
import { RichInline } from "../rich.tsx"
import { compilePlot, defaultFrame, evalFn, initialValues, samplePath, scaleFor, ticks } from "./plot-math.ts"
import { formatNumber, ParamSlider } from "./slider.tsx"

const partAttrs = (part: string | undefined, known: boolean) =>
  part === undefined || !known ? {} : { "data-p": part, "data-target": `part:${part}` }

export function PlotView(props: {
  readonly widget: PlotWidget
  readonly sectionId: string
  readonly label: string
}) {
  const w = props.widget
  const { model, t } = useLesson()
  const lang = model.spec.lang
  const compiled = useMemo(() => compilePlot(w), [w])
  const [vars, setVars] = useState(() => initialValues(w.params))
  const f = defaultFrame
  const s = scaleFor(w, f)
  const known = (id: string | undefined) => id !== undefined && model.part(id) !== undefined
  const clipId = `lsn-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const xTicks = ticks(w.x.min, w.x.max)
  const yTicks = ticks(w.y.min, w.y.max)
  const x0 = s.x(Math.min(Math.max(0, w.x.min), w.x.max))
  const y0 = s.y(Math.min(Math.max(0, w.y.min), w.y.max))
  const errors = compiled.curves.flatMap((c, i) => (c.ok ? [] : [{ i, error: c.error }]))

  return (
    <figure className="lsn-plot">
      {w.y.label !== undefined && (
        <figcaption className="lsn-axis-label lsn-axis-y">
          <RichInline src={w.y.label} />
        </figcaption>
      )}
      <svg
        viewBox={`0 0 ${f.width} ${f.height}`}
        className="lsn-plot-svg"
        role="img"
        aria-label={`${props.label}: ${w.curves.map((c) => (c.label === undefined ? c.expr : richText(c.label))).join("; ")}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={f.left}
              y={f.top}
              width={f.width - f.left - f.right}
              height={f.height - f.top - f.bottom}
            />
          </clipPath>
        </defs>
        <g className="lsn-plot-grid">
          {xTicks.map((v) => (
            <line key={`x${v}`} x1={s.x(v)} x2={s.x(v)} y1={f.top} y2={f.height - f.bottom} />
          ))}
          {yTicks.map((v) => (
            <line key={`y${v}`} x1={f.left} x2={f.width - f.right} y1={s.y(v)} y2={s.y(v)} />
          ))}
        </g>
        <g className="lsn-plot-axes">
          <line x1={f.left} x2={f.width - f.right} y1={y0} y2={y0} />
          <line x1={x0} x2={x0} y1={f.top} y2={f.height - f.bottom} />
          {xTicks.map((v) => (
            <text key={`tx${v}`} x={s.x(v)} y={f.height - f.bottom + 16} textAnchor="middle">
              {formatNumber(lang, v)}
            </text>
          ))}
          {yTicks.map((v) => (
            <text key={`ty${v}`} x={f.left - 6} y={s.y(v)} textAnchor="end" dominantBaseline="middle">
              {formatNumber(lang, v)}
            </text>
          ))}
        </g>
        <g clipPath={`url(#${clipId})`}>
          {w.curves.map((c, i) => {
            const fn = compiled.curves[i]
            if (fn === undefined || !fn.ok) return null
            const d = samplePath(fn.fn, vars, w, f)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: curves are positional
              <g key={i} className="lsn-plot-curve" {...partAttrs(c.part, known(c.part))}>
                <path d={d} className="lsn-plot-line" />
                <path d={d} className="lsn-plot-hit" />
              </g>
            )
          })}
          {(w.points ?? []).map((p, i) => {
            const fns = compiled.points[i]
            if (fns === undefined) return null
            const px = evalFn(fns.x, vars)
            const py = evalFn(fns.y, vars)
            if (!Number.isFinite(px) || !Number.isFinite(py)) return null
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
              <g key={i} className="lsn-plot-point" {...partAttrs(p.part, known(p.part))}>
                <circle cx={s.x(px)} cy={s.y(py)} r={5} />
                <circle cx={s.x(px)} cy={s.y(py)} r={12} className="lsn-plot-hit" />
                {p.label !== undefined && <title>{richText(p.label)}</title>}
              </g>
            )
          })}
        </g>
      </svg>
      {w.x.label !== undefined && (
        <div className="lsn-axis-label lsn-axis-x">
          <RichInline src={w.x.label} />
        </div>
      )}
      {errors.length > 0 && (
        <ul className="lsn-errors">
          {errors.map((e) => (
            <li key={e.i}>{t("plot.badExpr", { message: e.error })}</li>
          ))}
        </ul>
      )}
      <ul className="lsn-plot-legend">
        {w.curves.map((c, i) =>
          c.label === undefined ? null : (
            // biome-ignore lint/suspicious/noArrayIndexKey: curves are positional
            <li key={`c${i}`} {...partAttrs(c.part, known(c.part))}>
              <span className="lsn-legend-line" aria-hidden />
              <RichInline src={c.label} />
            </li>
          ),
        )}
        {(w.points ?? []).map((p, i) =>
          p.label === undefined ? null : (
            // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
            <li key={`p${i}`} {...partAttrs(p.part, known(p.part))}>
              <span className="lsn-legend-dot" aria-hidden />
              <RichInline src={p.label} />
            </li>
          ),
        )}
      </ul>
      {w.params.length > 0 && (
        <div className="lsn-sliders">
          {w.params.map((p) => (
            <ParamSlider
              key={p.id}
              param={p}
              lang={lang}
              value={vars[p.id] ?? p.value}
              onChange={(v) => setVars((old) => ({ ...old, [p.id]: v }))}
            />
          ))}
        </div>
      )}
      {(w.readouts ?? []).length > 0 && (
        <dl className="lsn-readouts" aria-live="polite">
          {(w.readouts ?? []).map((r, i) => {
            const fn = compiled.readouts[i]
            const v = fn === undefined ? Number.NaN : evalFn(fn, vars)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: readouts are positional
              <div key={i} className="lsn-readout" {...partAttrs(r.part, known(r.part))}>
                <dt>
                  <RichInline src={r.label} />
                </dt>
                <dd>
                  {formatNumber(lang, v)}
                  {r.unit === undefined ? "" : ` ${r.unit}`}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </figure>
  )
}
