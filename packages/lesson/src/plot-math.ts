import type { ExprFn } from "@app/domain"

export interface Pt {
  readonly x: number
  readonly y: number
}

// Samples y = fn(x) over [x0, x1]. A NaN, an infinity or a throw ends the current segment, so the
// drawn path has a gap there instead of a line to (0, 0) or off to infinity.
export function sampleCurve(
  fn: ExprFn,
  vars: Readonly<Record<string, number>>,
  x0: number,
  x1: number,
  n = 240,
): Array<Array<Pt>> {
  const segs: Array<Array<Pt>> = []
  let cur: Array<Pt> = []
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n
    let y: number
    try {
      y = fn({ ...vars, x })
    } catch {
      y = Number.NaN
    }
    if (Number.isFinite(y)) cur.push({ x, y })
    else if (cur.length > 0) {
      segs.push(cur)
      cur = []
    }
  }
  if (cur.length > 0) segs.push(cur)
  return segs
}

// SVG path data for sampled segments, each a separate `M … L …` run. Y is clamped far outside the
// plot so a steep curve still clips cleanly instead of producing huge coordinates.
export function segmentsToPath(
  segs: ReadonlyArray<ReadonlyArray<Pt>>,
  sx: (x: number) => number,
  sy: (y: number) => number,
): string {
  const clamp = (v: number) => Math.max(-1e4, Math.min(1e4, v))
  return segs
    .map((seg) =>
      seg.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)} ${clamp(sy(p.y)).toFixed(1)}`).join(""),
    )
    .join("")
}

// About `count` round tick values (1, 2, 2.5, 5 × 10^k) covering [min, max].
export function niceTicks(min: number, max: number, count = 5): Array<number> {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const out: Array<number> = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)))
  }
  return out
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const a = Math.abs(v)
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2
  return String(Number(v.toFixed(digits)))
}
