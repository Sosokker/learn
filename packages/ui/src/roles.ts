// The lesson role palette (roles.css), for lesson content only. The names match `RoleColor` in
// packages/domain/src/lesson.ts exactly; this package does not import the domain, so keep the
// two lists in step.
export const roleColors = [
  "red",
  "orange",
  "peach",
  "yellow",
  "mustard",
  "olive",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "rose",
  "grey",
] as const

export type RoleColorName = (typeof roleColors)[number]

// The CSS color for a role, for inline styles and SVG (`fill`, `stroke`) in the lesson renderer.
export function roleColorVar(color: RoleColorName) {
  return `var(--color-role-${color})`
}

// A translucent tint of a role color, for highlighted backgrounds behind lesson text.
export function roleTintVar(color: RoleColorName, percent = 15) {
  return `color-mix(in oklab, var(--color-role-${color}) ${percent}%, transparent)`
}
