// Joins class names, skipping falsy ones. Small on purpose: no conflict resolution, so callers
// add classes rather than override them.
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
