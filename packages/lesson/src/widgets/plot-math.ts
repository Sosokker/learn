// Pure plot math: compile the widget's expressions once (safe parser, no eval), then sample
// curves into SVG paths for the current slider values.

import { type Compiled, compile, type PlotWidget, type Vars } from "@app/domain"

export interface Frame {
  readonly width: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export const defaultFrame: Frame = { width: 520, height: 300, left: 44, right: 14, top: 12, bottom: 30 }

type Fn = { readonly ok: true; readonly fn: Compiled } | { readonly ok: false; readonly error: string }

const compileOne = (src: string): Fn => {
  const r = compile(src)
  return r._tag === "Success" ? { ok: true, fn: r.success } : { ok: false, error: r.failure.message }
}

export interface CompiledPlot {
  readonly curves: ReadonlyArray<Fn>
  readonly points: ReadonlyArray<{ readonly x: Fn; readonly y: Fn }>
  readonly readouts: ReadonlyArray<Fn>
}

export const compilePlot = (w: PlotWidget): CompiledPlot => ({
  curves: w.curves.map((c) => compileOne(c.expr)),
  points: (w.points ?? []).map((p) => ({ x: compileOne(p.x), y: compileOne(p.y) })),
  readouts: (w.readouts ?? []).map((r) => compileOne(r.expr)),
})

export const evalFn = (f: Fn, vars: Vars): number => (f.ok ? f.fn(vars) : Number.NaN)

export interface Scale {
  readonly x: (v: number) => number
  readonly y: (v: number) => number
}

export const scaleFor = (w: PlotWidget, f: Frame = defaultFrame): Scale => {
  const iw = f.width - f.left - f.right
  const ih = f.height - f.top - f.bottom
  const sx = iw / (w.x.max - w.x.min || 1)
  const sy = ih / (w.y.max - w.y.min || 1)
  return {
    x: (v) => f.left + (v - w.x.min) * sx,
    y: (v) => f.top + ih - (v - w.y.min) * sy,
  }
}

/**
 * Sample `fn` over the x axis into an SVG path. The path breaks where the value is not finite or
 * leaves the plot far enough that drawing it would only add noise (the plot clips the rest).
 */
export const samplePath = (
  fn: Compiled,
  vars: Vars,
  w: PlotWidget,
  f: Frame = defaultFrame,
  samples = 240,
): string => {
  const s = scaleFor(w, f)
  const span = w.y.max - w.y.min
  const lo = w.y.min - span * 4
  const hi = w.y.max + span * 4
  let d = ""
  let pen = false
  for (let i = 0; i <= samples; i++) {
    const x = w.x.min + ((w.x.max - w.x.min) * i) / samples
    const y = fn({ ...vars, x })
    if (!Number.isFinite(y) || y < lo || y > hi) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${s.x(x).toFixed(2)},${s.y(y).toFixed(2)}`
    pen = true
  }
  return d
}

/** About five round tick values inside [min, max]. */
export const ticks = (min: number, max: number, count = 5): ReadonlyArray<number> => {
  const span = max - min
  if (!(span > 0) || !Number.isFinite(span)) return [min]
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count + 0.5) ?? 10 * pow
  const out: Array<number> = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
  }
  return out
}

export const initialValues = (params: ReadonlyArray<{ readonly id: string; readonly value: number }>): Vars =>
  Object.fromEntries(params.map((p) => [p.id, p.value]))
