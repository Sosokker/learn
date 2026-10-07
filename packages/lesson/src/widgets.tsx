import {
  compileExpr,
  type ExprFn,
  type InclineWidget,
  type Param,
  type PlotWidget,
  richToPlain,
  type TableWidget,
  type TraceWidget,
} from "@app/domain"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useLesson } from "./context.ts"
import { formatNumber, niceTicks, sampleCurve, segmentsToPath } from "./plot-math.ts"
import { Rich } from "./rich.tsx"

type Vars = Readonly<Record<string, number>>

function tryCompile(src: string): ExprFn | null {
  try {
    return compileExpr(src).fn
  } catch {
    return null
  }
}

function evalSafe(fn: ExprFn | null, vars: Vars): number {
  if (fn === null) return Number.NaN
  try {
    return fn(vars)
  } catch {
    return Number.NaN
  }
}

function useParams(params: ReadonlyArray<Param>) {
  return useState<Vars>(() => Object.fromEntries(params.map((p) => [p.id, p.value])))
}

// Width of an element, tracked so SVG text keeps its pixel size on phones instead of scaling down.
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (el === null || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width
      if (cw !== undefined && cw > 0) setW(Math.round(cw))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function Sliders({
  params,
  vars,
  onChange,
}: {
  readonly params: ReadonlyArray<Param>
  readonly vars: Vars
  readonly onChange: (id: string, v: number) => void
}) {
  return (
    <div className="lx-sliders">
      {params.map((p) => (
        <label key={p.id} className="lx-slider" data-part={p.part}>
          <span className="lx-slider-label">
            <Rich src={p.label} inline />
          </span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={vars[p.id] ?? p.value}
            onChange={(e) => onChange(p.id, Number(e.currentTarget.value))}
          />
          <output className="lx-slider-value">{formatNumber(vars[p.id] ?? p.value)}</output>
        </label>
      ))}
    </div>
  )
}

const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "")

export function Plot({ w }: { readonly w: typeof PlotWidget.Type }) {
  const { s } = useLesson()
  const [vars, setVars] = useParams(w.params)
  const [box, width] = useWidth<HTMLDivElement>(640)
  const clip = `lx-clip-${svgId(useId())}`
  const curves = useMemo(() => w.curves.map((c) => ({ ...c, fn: tryCompile(c.expr) })), [w.curves])
  const points = useMemo(
    () => (w.points ?? []).map((p) => ({ ...p, fx: tryCompile(p.x), fy: tryCompile(p.y) })),
    [w.points],
  )
  const readouts = useMemo(
    () => (w.readouts ?? []).map((r) => ({ ...r, fn: tryCompile(r.expr) })),
    [w.readouts],
  )

  const W = Math.max(280, width)
  const H = Math.round(Math.min(360, Math.max(220, W * 0.52)))
  const m = { l: 44, r: 12, t: 12, b: 28 }
  const sx = (x: number) => m.l + ((x - w.x.min) / (w.x.max - w.x.min)) * (W - m.l - m.r)
  const sy = (y: number) => H - m.b - ((y - w.y.min) / (w.y.max - w.y.min)) * (H - m.t - m.b)
  const xt = niceTicks(w.x.min, w.x.max, Math.max(3, Math.floor(W / 70)))
  const yt = niceTicks(w.y.min, w.y.max, 5)
  const samples = Math.min(400, Math.max(120, Math.round(W / 2)))

  return (
    <div className="lx-plot">
      <Sliders params={w.params} vars={vars} onChange={(id, v) => setVars((o) => ({ ...o, [id]: v }))} />
      {w.y.label === undefined ? null : (
        <div className="lx-axis-label lx-axis-y">
          <Rich src={w.y.label} inline />
        </div>
      )}
      <div ref={box} className="lx-plot-box">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={w.y.label ?? "plot"}>
          <defs>
            <clipPath id={clip}>
              <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
            </clipPath>
          </defs>
          <g className="lx-grid">
            {xt.map((t) => (
              <line key={`x${t}`} x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} />
            ))}
            {yt.map((t) => (
              <line key={`y${t}`} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            ))}
          </g>
          <g className="lx-axis">
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
            <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} />
            {xt.map((t) => (
              <text key={`x${t}`} x={sx(t)} y={H - m.b + 16} textAnchor="middle">
                {formatNumber(t)}
              </text>
            ))}
            {yt.map((t) => (
              <text key={`y${t}`} x={m.l - 6} y={sy(t) + 4} textAnchor="end">
                {formatNumber(t)}
              </text>
            ))}
          </g>
          <g clipPath={`url(#${clip})`}>
            {curves.map((c, i) => {
              if (c.fn === null) return null
              const d = segmentsToPath(sampleCurve(c.fn, vars, w.x.min, w.x.max, samples), sx, sy)
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: curves are a fixed list
                <g key={i} className="lx-curve" data-part={c.part}>
                  <path d={d} className="lx-curve-hit" />
                  <path d={d} className="lx-curve-line" />
                </g>
              )
            })}
            {points.map((p, i) => {
              const x = evalSafe(p.fx, vars)
              const y = evalSafe(p.fy, vars)
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: points are a fixed list
                <g key={i} className="lx-point" data-part={p.part}>
                  <circle cx={sx(x)} cy={sy(y)} r={5} />
                  {p.label === undefined ? null : (
                    <text
                      x={sx(x) + (sx(x) > W - 120 ? -9 : 9)}
                      y={sy(y) - 8}
                      textAnchor={sx(x) > W - 120 ? "end" : "start"}
                    >
                      {richToPlain(p.label)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      {w.x.label === undefined ? null : (
        <div className="lx-axis-label lx-axis-x">
          <Rich src={w.x.label} inline />
        </div>
      )}
      {curves.some((c) => c.label !== undefined || c.fn === null) ? (
        <ul className="lx-legend">
          {curves.map((c, i) =>
            c.label === undefined && c.fn !== null ? null : (
              // biome-ignore lint/suspicious/noArrayIndexKey: curves are a fixed list
              <li key={i} data-part={c.part} className="lx-legend-item">
                <span className="lx-legend-swatch" />
                {c.label === undefined ? null : <Rich src={c.label} inline />}
                {c.fn === null ? (
                  <span className="lx-error">
                    {" "}
                    ({s.exprError}: {c.expr})
                  </span>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {readouts.length > 0 ? (
        <div className="lx-readouts">
          {readouts.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: readouts are a fixed list
            <div key={i} className="lx-readout" data-part={r.part}>
              <span className="lx-readout-label">
                <Rich src={r.label} inline />
              </span>
              <span className="lx-readout-eq">=</span>
              <span className="lx-readout-value">{formatNumber(evalSafe(r.fn, vars))}</span>
              {r.unit === undefined ? null : <span className="lx-readout-unit">{r.unit}</span>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Table({ w }: { readonly w: typeof TableWidget.Type }) {
  return (
    <div className="lx-table-wrap">
      <table className="lx-table">
        <thead>
          <tr>
            {w.head.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              <th key={i}>
                <Rich src={h} inline />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {w.rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            <tr key={i}>
              {r.map((c, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <td key={j}>
                  <Rich src={c} inline />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Arrow({
  x,
  y,
  dx,
  dy,
  label,
  part,
}: {
  readonly x: number
  readonly y: number
  readonly dx: number
  readonly dy: number
  readonly label: string
  readonly part: string | undefined
}) {
  const len = Math.hypot(dx, dy)
  if (len < 4) return null
  const ux = dx / len
  const uy = dy / len
  const tx = x + dx
  const ty = y + dy
  const head = 9
  const hx = tx - ux * head
  const hy = ty - uy * head
  const lx = tx + ux * 14
  const ly = ty + uy * 14
  return (
    <g className="lx-force" data-part={part}>
      <line x1={x} y1={y} x2={hx} y2={hy} />
      <polygon points={`${tx},${ty} ${hx - uy * 5},${hy + ux * 5} ${hx + uy * 5},${hy - ux * 5}`} />
      <text x={lx} y={ly + 4} textAnchor={ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle"}>
        {label}
      </text>
    </g>
  )
}

// An incline with a block. The angle param (degrees) tilts it; `mu`, when present, sizes friction.
export function Incline({ w }: { readonly w: typeof InclineWidget.Type }) {
  const { s } = useLesson()
  const [vars, setVars] = useParams(w.params)
  const angleParam = w.params.find((p) => p.id === "angle" || p.id === "theta") ?? w.params[0]
  const deg = Math.max(0, Math.min(80, angleParam ? (vars[angleParam.id] ?? angleParam.value) : 30))
  const th = (deg * Math.PI) / 180
  const mu = vars.mu ?? 0.3
  const W = 560
  const H = 320
  const x0 = 70
  const y0 = H - 50
  const hyp = Math.min(420, th > 0 ? 220 / Math.sin(th) : 420)
  const x1 = x0 + hyp * Math.cos(th)
  const y1 = y0 - hyp * Math.sin(th)
  // Unit vectors in SVG coordinates (y down): up the slope, and out of the surface.
  const ux = Math.cos(th)
  const uy = -Math.sin(th)
  const nx = -Math.sin(th)
  const ny = -Math.cos(th)
  const t = 0.55
  const bw = 64
  const bh = 38
  const cx = x0 + (x1 - x0) * t + nx * (bh / 2)
  const cy = y0 + (y1 - y0) * t + ny * (bh / 2)
  const g = 110
  const normal = g * Math.cos(th)
  const friction = g * Math.min(Math.sin(th), mu * Math.cos(th))
  const accel = Math.max(0, g * (Math.sin(th) - mu * Math.cos(th)))
  const part = (f: string) => (Object.hasOwn(w.parts, f) ? w.parts[f] : undefined)
  const has = (f: "weight" | "normal" | "friction" | "accel") => w.forces.includes(f)
  return (
    <div className="lx-incline">
      <Sliders params={w.params} vars={vars} onChange={(id, v) => setVars((o) => ({ ...o, [id]: v }))} />
      <svg viewBox={`0 0 ${W} ${H}`} className="lx-incline-svg" role="img" aria-label="incline">
        <polygon className="lx-ramp" points={`${x0},${y0} ${x1},${y0} ${x1},${y1}`} />
        <line className="lx-ground" x1={20} x2={W - 20} y1={y0} y2={y0} />
        <path
          className="lx-angle"
          d={`M${x0 + 44},${y0} A44,44 0 0 0 ${x0 + 44 * Math.cos(th)},${y0 - 44 * Math.sin(th)}`}
        />
        <text className="lx-angle-label" x={x0 + 52} y={y0 - 10}>
          {`θ = ${formatNumber(deg)}°`}
        </text>
        <rect
          className="lx-block"
          x={cx - bw / 2}
          y={cy - bh / 2}
          width={bw}
          height={bh}
          rx={4}
          transform={`rotate(${-deg} ${cx} ${cy})`}
        />
        {has("weight") ? (
          <Arrow x={cx} y={cy} dx={0} dy={g} label={s.forces.weight ?? "weight"} part={part("weight")} />
        ) : null}
        {has("normal") ? (
          <Arrow
            x={cx}
            y={cy}
            dx={nx * normal}
            dy={ny * normal}
            label={s.forces.normal ?? "normal"}
            part={part("normal")}
          />
        ) : null}
        {has("friction") ? (
          <Arrow
            x={cx}
            y={cy}
            dx={ux * friction}
            dy={uy * friction}
            label={s.forces.friction ?? "friction"}
            part={part("friction")}
          />
        ) : null}
        {has("accel") ? (
          <Arrow
            x={cx - ux * (bw / 2 + 4)}
            y={cy - uy * (bw / 2 + 4)}
            dx={-ux * accel}
            dy={-uy * accel}
            label={s.forces.accel ?? "acceleration"}
            part={part("accel")}
          />
        ) : null}
      </svg>
    </div>
  )
}

export function Trace({ w }: { readonly w: typeof TraceWidget.Type }) {
  const { s } = useLesson()
  const [i, setI] = useState(0)
  const step = w.steps[Math.min(i, w.steps.length - 1)]
  const lines = w.code.split("\n")
  const vars = Object.entries(step?.state ?? {})
  return (
    <div className="lx-trace">
      <pre className="lx-trace-code" data-lang={w.lang}>
        {lines.map((l, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: code lines are positional
          <div key={n} className={step?.line === n + 1 ? "lx-trace-line is-current" : "lx-trace-line"}>
            <span className="lx-trace-ln">{n + 1}</span>
            <span>{l === "" ? " " : l}</span>
          </div>
        ))}
      </pre>
      {w.steps.length > 0 ? (
        <div className="lx-trace-ctl">
          <button
            type="button"
            className="lx-btn"
            disabled={i === 0}
            onClick={() => setI((v) => Math.max(0, v - 1))}
          >
            ‹
          </button>
          <input
            type="range"
            min={0}
            max={w.steps.length - 1}
            step={1}
            value={i}
            aria-label={s.step}
            onChange={(e) => setI(Number(e.currentTarget.value))}
          />
          <button
            type="button"
            className="lx-btn"
            disabled={i >= w.steps.length - 1}
            onClick={() => setI((v) => Math.min(w.steps.length - 1, v + 1))}
          >
            ›
          </button>
          <span className="lx-trace-count">
            {s.step} {i + 1}/{w.steps.length}
          </span>
        </div>
      ) : null}
      {step === undefined ? null : (
        <div className="lx-trace-state">
          <div className="lx-trace-note">
            <Rich src={step.note} />
          </div>
          {vars.length > 0 ? (
            <table className="lx-table lx-table-dense">
              <thead>
                <tr>
                  <th>{s.variable}</th>
                  <th>{s.value}</th>
                </tr>
              </thead>
              <tbody>
                {vars.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <code className="lx-code">{k}</code>
                    </td>
                    <td>
                      <code className="lx-code">{v}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </div>
  )
}
