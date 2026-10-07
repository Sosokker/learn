// Block on a rough incline (the prototype's "Solve" picture), as pure geometry + physics.
//
// The widget's params are found by id: angle `theta` | `th` | `angle` (degrees), friction
// coefficient `mu` | `mu_k`, mass `m` | `mass`, slide distance `d` | `dist`, gravity `g`.
// Missing ones use the defaults below. `parts` maps a force name (weight, normal, friction, accel)
// to a part id, as the validator reads it.

import type { InclineWidget } from "@app/domain"

const aliases = {
  theta: ["theta", "th", "angle"],
  mu: ["mu", "mu_k"],
  m: ["m", "mass"],
  d: ["d", "dist"],
  g: ["g"],
} as const

export type InclineVar = keyof typeof aliases

export const inclineDefaults: Record<InclineVar, number> = { theta: 30, mu: 0.2, m: 2, d: 5, g: 9.8 }

/** The param id that plays a role (e.g. which param is the angle), if any. */
export const inclineParamId = (w: InclineWidget, role: InclineVar): string | undefined =>
  w.params.find((p) => (aliases[role] as ReadonlyArray<string>).includes(p.id))?.id

export const inclineVars = (
  w: InclineWidget,
  values: Readonly<Record<string, number>>,
): Record<InclineVar, number> => {
  const get = (role: InclineVar) => {
    const id = inclineParamId(w, role)
    const v = id === undefined ? undefined : values[id]
    return v === undefined || !Number.isFinite(v) ? inclineDefaults[role] : v
  }
  return { theta: get("theta"), mu: get("mu"), m: get("m"), d: get("d"), g: get("g") }
}

export interface InclinePhysics {
  readonly slides: boolean
  readonly tan: number
  readonly weight: number
  readonly normal: number
  /** Friction while sliding (μN), or the static friction that holds the block (mg sin θ). */
  readonly friction: number
  readonly accel: number
  readonly speed: number
}

export const inclinePhysics = (v: Record<InclineVar, number>): InclinePhysics => {
  const t = (v.theta * Math.PI) / 180
  const s = Math.sin(t)
  const c = Math.cos(t)
  const tan = Math.tan(t)
  const slides = tan > v.mu
  const weight = v.m * v.g
  const normal = weight * c
  const accel = slides ? v.g * (s - v.mu * c) : 0
  return {
    slides,
    tan,
    weight,
    normal,
    friction: slides ? v.mu * normal : weight * s,
    accel,
    speed: slides ? Math.sqrt(2 * accel * v.d) : 0,
  }
}

type Pt = readonly [number, number]

export interface Arrow {
  readonly force: "weight" | "normal" | "friction" | "accel"
  readonly from: Pt
  readonly to: Pt
  readonly head: readonly [Pt, Pt, Pt]
  readonly label: Pt
  readonly anchor: "start" | "middle" | "end"
}

export interface InclineScene {
  readonly ramp: readonly [Pt, Pt, Pt]
  readonly block: readonly [Pt, Pt, Pt, Pt]
  readonly arc: ReadonlyArray<Pt>
  readonly thetaLabel: Pt
  readonly distance: readonly [Pt, Pt]
  readonly distanceLabel: Pt
  readonly topLabel: Pt
  readonly bottomLabel: Pt
  readonly arrows: ReadonlyArray<Arrow>
  readonly viewBox: string
}

const add = (p: Pt, v: Pt, k: number): Pt => [p[0] + v[0] * k, p[1] + v[1] * k]

/**
 * Scene in SVG coordinates. Force arrows use a fixed scale against the weight (the weight arrow is
 * always the same length), so changing the mass changes the numbers, not the picture.
 */
export const inclineScene = (
  v: Record<InclineVar, number>,
  ph: InclinePhysics,
  forces: ReadonlyArray<Arrow["force"]>,
): InclineScene => {
  const t = (v.theta * Math.PI) / 180
  const s = Math.sin(t)
  const c = Math.cos(t)
  const L = 300
  const A: Pt = [0, 0]
  const u: Pt = [c, -s] // up the slope
  const n: Pt = [-s, -c] // out of the slope
  const B = add(A, u, L)
  const C: Pt = [B[0], A[1]]
  const bs = 34
  const P0 = add(A, u, 0.6 * L)
  const block: InclineScene["block"] = [
    add(P0, u, -bs / 2),
    add(P0, u, bs / 2),
    add(add(P0, u, bs / 2), n, bs),
    add(add(P0, u, -bs / 2), n, bs),
  ]
  const center = add(P0, n, bs / 2)
  const k = 72 / (ph.weight || 1)
  const arrow = (force: Arrow["force"], from: Pt, dir: Pt, len: number): Arrow | undefined => {
    if (!(len >= 4)) return undefined
    const to = add(from, dir, len)
    const base = add(to, dir, -9)
    const nx = -dir[1]
    const ny = dir[0]
    const label = add(to, dir, 13)
    const anchor = dir[0] > 0.35 ? "start" : dir[0] < -0.35 ? "end" : "middle"
    return {
      force,
      from,
      to,
      head: [to, [base[0] + nx * 5, base[1] + ny * 5], [base[0] - nx * 5, base[1] - ny * 5]],
      label,
      anchor,
    }
  }
  const faceUp = add(add(P0, u, bs / 2), n, bs / 2)
  const faceDown = add(add(P0, u, -bs / 2 - 4), n, bs / 2)
  const wanted = new Set(forces)
  const arrows = [
    wanted.has("weight") ? arrow("weight", center, [0, 1], ph.weight * k) : undefined,
    wanted.has("normal") ? arrow("normal", center, n, ph.normal * k) : undefined,
    wanted.has("friction") ? arrow("friction", faceUp, u, ph.friction * k) : undefined,
    wanted.has("accel") ? arrow("accel", faceDown, [-u[0], -u[1]], ph.accel * 6) : undefined,
  ].filter((a): a is Arrow => a !== undefined)
  const arc = Array.from(
    { length: 13 },
    (_, i): Pt => [38 * Math.cos((t * i) / 12), -38 * Math.sin((t * i) / 12)],
  )
  let distanceLabel = add(add(A, u, L * 0.3), n, -32)
  if (distanceLabel[1] > A[1] - 8) distanceLabel = [distanceLabel[0] + 20, A[1] + 15]
  const thetaLabel: Pt = [-10, 14]
  const topLabel: Pt = [B[0] + 8, B[1] - 2]
  const bottomLabel: Pt = [-8, -10]
  // Bounds: every point drawn, plus room for labels (text is ~8px per char at 13px).
  const pts: Array<Pt> = [A, B, C, ...block, ...arrows.flatMap((a) => [a.to, a.label]), distanceLabel]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs, bottomLabel[0] - 130, thetaLabel[0] - 14) - 12
  const maxX = Math.max(...xs, topLabel[0] + 60) + 24
  const minY = Math.min(...ys, topLabel[1] - 10) - 16
  const maxY = Math.max(...ys, thetaLabel[1] + 10, distanceLabel[1] + 10) + 12
  return {
    ramp: [A, B, C],
    block,
    arc,
    thetaLabel,
    distance: [add(A, n, -10), add(B, n, -10)],
    distanceLabel,
    topLabel,
    bottomLabel,
    arrows,
    viewBox: `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`,
  }
}
