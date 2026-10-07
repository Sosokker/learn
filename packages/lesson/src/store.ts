import { useSyncExternalStore } from "react"

// A tiny external store. Lesson-wide UI state (inspector, try mode, @refs) lives here instead of in
// LessonView's React state, so changing it re-renders only the components that read it, not the
// whole lesson tree with its KaTeX.
export interface Store<T> {
  readonly get: () => T
  readonly set: (next: T | ((prev: T) => T)) => void
  readonly subscribe: (fn: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      const v = typeof next === "function" ? (next as (prev: T) => T)(value) : next
      if (Object.is(v, value)) return
      value = v
      for (const fn of subs) fn()
    },
    subscribe: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}

export function useStore<T, S>(store: Store<T>, select: (v: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
