import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { type MessageKey, messages } from "./messages.ts"

export type UiLang = "en" | "th"
export const uiLangs: ReadonlyArray<UiLang> = ["en", "th"]

const storageKey = "learn.lang"

// Storage can throw (private mode, blocked cookies); the language then just isn't remembered.
function readStoredLang(): UiLang | null {
  try {
    const value = localStorage.getItem(storageKey)
    return value === "en" || value === "th" ? value : null
  } catch {
    return null
  }
}

function storeLang(lang: UiLang) {
  try {
    localStorage.setItem(storageKey, lang)
  } catch {
    // Not remembered; still applied for this visit.
  }
}

// Stored choice first, then the browser's language.
export function detectLang(): UiLang {
  const stored = readStoredLang()
  if (stored) return stored
  const nav = typeof navigator === "undefined" ? "" : navigator.language
  return nav.toLowerCase().startsWith("th") ? "th" : "en"
}

export type TranslateVars = Readonly<Record<string, string | number>>
export type Translate = (key: MessageKey, vars?: TranslateVars) => string

function format(template: string, vars: TranslateVars | undefined): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export interface I18n {
  readonly lang: UiLang
  readonly setLang: (lang: UiLang) => void
  readonly t: Translate
  // Dates and numbers in the UI language (Thai uses the Buddhist calendar by default).
  readonly formatDate: (ms: number) => string
  readonly formatRelative: (ms: number) => string
  readonly formatNumber: (n: number) => string
}

const I18nContext = createContext<I18n | null>(null)

const units: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["week", 7 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
]

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: UiLang }) {
  const [lang, setLangState] = useState<UiLang>(() => initialLang ?? detectLang())

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: UiLang) => {
    storeLang(next)
    setLangState(next)
  }, [])

  const value = useMemo<I18n>(() => {
    const dict = messages[lang]
    const dateFmt = new Intl.DateTimeFormat(lang, { year: "numeric", month: "short", day: "numeric" })
    const relFmt = new Intl.RelativeTimeFormat(lang, { numeric: "auto" })
    const numFmt = new Intl.NumberFormat(lang, { notation: "compact" })
    return {
      lang,
      setLang,
      t: (key, vars) => format(dict[key], vars),
      formatDate: (ms) => dateFmt.format(ms),
      formatRelative: (ms) => {
        const diff = ms - Date.now()
        for (const [unit, size] of units) {
          if (Math.abs(diff) >= size) return relFmt.format(Math.round(diff / size), unit)
        }
        return relFmt.format(0, "minute")
      },
      formatNumber: (n) => numFmt.format(n),
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n needs an <I18nProvider>")
  return value
}

export function useT(): Translate {
  return useI18n().t
}
