import { useSyncExternalStore } from "react"

// Reader preferences: color theme and lesson text size. Remembered per browser in localStorage
// (no server copy yet) and applied as attributes on <html>, which the tokens read:
//   data-theme="light" | "dark"   absent = follow the system (prefers-color-scheme)
//   data-text-size="sm" | "lg"    absent = default size
// apps/web/public/prefs.js applies the same keys before the first paint, so a stored light
// theme does not flash dark. Keep the keys and values here and there in step.

export const themes = ["system", "light", "dark"] as const
export type Theme = (typeof themes)[number]
export const textSizes = ["sm", "md", "lg"] as const
export type TextSize = (typeof textSizes)[number]
export type ResolvedTheme = "light" | "dark"

export type Preferences = { readonly theme: Theme; readonly textSize: TextSize }

export const preferenceKeys = { theme: "learn.theme", textSize: "learn.textSize" } as const

// The browser bar color per theme: the canvas token.
export const themeColors: Record<ResolvedTheme, string> = { light: "#ffffff", dark: "#010102" }

export function parsePreferences(stored: {
  readonly theme: string | null
  readonly textSize: string | null
}): Preferences {
  return {
    theme: themes.find((value) => value === stored.theme) ?? "system",
    textSize: textSizes.find((value) => value === stored.textSize) ?? "md",
  }
}

export function resolveTheme(theme: Theme, systemPrefersLight: boolean): ResolvedTheme {
  if (theme !== "system") return theme
  return systemPrefersLight ? "light" : "dark"
}

// The <html> attributes for a set of preferences; `null` removes the attribute.
export function rootAttributes(preferences: Preferences) {
  return {
    "data-theme": preferences.theme === "system" ? null : preferences.theme,
    "data-text-size": preferences.textSize === "md" ? null : preferences.textSize,
  } as const
}

// ── The browser store: one copy of the preferences, shared by every component that reads them.

const listeners = new Set<() => void>()
let current: Preferences | undefined

function read(): Preferences {
  return parsePreferences({
    theme: readStored(preferenceKeys.theme),
    textSize: readStored(preferenceKeys.textSize),
  })
}

function snapshot() {
  current ??= read()
  return current
}

const serverSnapshot: Preferences = { theme: "system", textSize: "md" }

function apply(preferences: Preferences) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  // Without this, every `transition-colors` element fades from the old theme on its own clock
  // and the page flickers; styles.css turns transitions off while the attribute is set.
  root.setAttribute("data-theme-switching", "")
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")))
  for (const [name, value] of Object.entries(rootAttributes(preferences))) {
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[resolveTheme(preferences.theme, systemPrefersLight())])
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab changed a preference: follow it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== preferenceKeys.theme && event.key !== preferenceKeys.textSize) return
    current = read()
    apply(current)
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  current = { ...snapshot(), [key]: value }
  writeStored(preferenceKeys[key], value)
  apply(current)
  for (const listener of listeners) listener()
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot, () => serverSnapshot)
}

// ── The system color scheme, for "system" and for widgets that need a concrete theme (React Flow).

const lightQuery = "(prefers-color-scheme: light)"

function systemPrefersLight() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(lightQuery).matches
    : false
}

function subscribeSystem(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(lightQuery)
  const onChange = () => {
    // The browser bar follows the system while the theme is "system".
    apply(snapshot())
    listener()
  }
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

export function useResolvedTheme(): ResolvedTheme {
  const { theme } = usePreferences()
  const prefersLight = useSyncExternalStore(subscribeSystem, systemPrefersLight, () => false)
  return resolveTheme(theme, prefersLight)
}

// localStorage throws when site data is blocked; a preference is a convenience, so a failure
// just means the default is used.
function readStored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; see readStored.
  }
}
