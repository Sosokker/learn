import type { InclineWidget } from "@app/domain"
import { useState } from "react"
import { useLesson } from "../context.tsx"
import { type Arrow, inclineParamId, inclinePhysics, inclineScene, inclineVars } from "./incline-math.ts"
import { initialValues } from "./plot-math.ts"
import { formatNumber, ParamSlider } from "./slider.tsx"

const glyph: Record<Arrow["force"], string> = { weight: "mg", normal: "N", friction: "fₖ", accel: "a" }
const unit: Record<Arrow["force"], string> = { weight: "N", normal: "N", friction: "N", accel: "m/s²" }

const pts = (ps: ReadonlyArray<readonly [number, number]>) =>
  ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")

export function InclineView(props: { readonly widget: InclineWidget; readonly label: string }) {
  const w = props.widget
  const { model, t } = useLesson()
  const lang = model.spec.lang
  const [values, setValues] = useState(() => initialValues(w.params))
  const v = inclineVars(w, values)
  const ph = inclinePhysics(v)
  const scene = inclineScene(v, ph, w.forces)
  const partOf = (force: Arrow["force"]) => {
    const id = w.parts[force]
    return id !== undefined && model.part(id) !== undefined ? id : undefined
  }
  const paramPart = (role: "theta" | "m" | "d" | "mu") => {
    const id = inclineParamId(w, role)
    const part = w.params.find((p) => p.id === id)?.part
    return part !== undefined && model.part(part) !== undefined ? part : undefined
  }
  const attrs = (part: string | undefined) =>
    part === undefined ? {} : { "data-p": part, "data-target": `part:${part}` }
  const value: Record<Arrow["force"], number> = {
    weight: ph.weight,
    normal: ph.normal,
    friction: ph.slides ? ph.friction : 0,
    accel: ph.accel,
  }
  const name: Record<Arrow["force"], string> = {
    weight: t("incline.weight"),
    normal: t("incline.normal"),
    friction: t("incline.friction"),
    accel: t("incline.accel"),
  }
  return (
    <figure className="lsn-incline">
      <svg viewBox={scene.viewBox} className="lsn-incline-svg" role="img" aria-label={props.label}>
        <polygon points={pts(scene.ramp)} className="lsn-incline-ramp" fillOpacity={0.06} />
        <g {...attrs(paramPart("theta"))} className="lsn-incline-mark">
          <polyline points={pts(scene.arc)} fill="none" strokeWidth={2} />
          <text x={scene.thetaLabel[0]} y={scene.thetaLabel[1]} textAnchor="end" dominantBaseline="middle">
            θ
          </text>
        </g>
        <g {...attrs(paramPart("d"))} className="lsn-incline-mark">
          <line
            x1={scene.distance[0][0]}
            y1={scene.distance[0][1]}
            x2={scene.distance[1][0]}
            y2={scene.distance[1][1]}
            strokeDasharray="4 3"
          />
          <text
            x={scene.distanceLabel[0]}
            y={scene.distanceLabel[1]}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            d = {formatNumber(lang, v.d)} m
          </text>
        </g>
        <polygon
          points={pts(scene.block)}
          className="lsn-incline-block"
          fillOpacity={0.85}
          {...attrs(paramPart("m"))}
        />
        {scene.arrows.map((a) => (
          <g key={a.force} className="lsn-incline-arrow" {...attrs(partOf(a.force))}>
            <line x1={a.from[0]} y1={a.from[1]} x2={a.head[0][0]} y2={a.head[0][1]} strokeWidth={2.4} />
            <polygon points={pts(a.head)} />
            <text x={a.label[0]} y={a.label[1]} textAnchor={a.anchor} dominantBaseline="middle">
              {glyph[a.force]}
            </text>
          </g>
        ))}
        <text
          x={scene.topLabel[0]}
          y={scene.topLabel[1]}
          dominantBaseline="middle"
          className="lsn-incline-note"
        >
          v₀ = 0
        </text>
        <text
          x={scene.bottomLabel[0]}
          y={scene.bottomLabel[1]}
          textAnchor="end"
          dominantBaseline="middle"
          className="lsn-incline-note"
        >
          v = {formatNumber(lang, ph.speed)} m/s
        </text>
      </svg>
      <div className="lsn-sliders">
        {w.params.map((p) => (
          <ParamSlider
            key={p.id}
            param={p}
            lang={lang}
            value={values[p.id] ?? p.value}
            onChange={(next) => setValues((old) => ({ ...old, [p.id]: next }))}
          />
        ))}
      </div>
      <dl className="lsn-readouts" aria-live="polite">
        {w.forces.map((f) => (
          <div key={f} className="lsn-readout" {...attrs(partOf(f))}>
            <dt>
              {name[f]} ({glyph[f]})
            </dt>
            <dd>
              {formatNumber(lang, value[f])} {unit[f]}
            </dd>
          </div>
        ))}
        <div className="lsn-readout">
          <dt>{t("incline.speed", { d: formatNumber(lang, v.d) })}</dt>
          <dd>{formatNumber(lang, ph.speed)} m/s</dd>
        </div>
      </dl>
      <p className={ph.slides ? "lsn-muted" : "lsn-warn"}>
        {ph.slides
          ? t("incline.slides", { tan: formatNumber(lang, ph.tan, 3) })
          : t("incline.sticks", { tan: formatNumber(lang, ph.tan, 3) })}
      </p>
    </figure>
  )
}
