// Joins class names, skipping empty ones. Tiny on purpose: components keep their own classes
// first and let a caller's `className` add to them (no tailwind-merge; avoid conflicting classes).
export function cx(...classes: ReadonlyArray<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}
