import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"

// A message is a template, or one template per plural category of the locale
// (Intl.PluralRules: Thai has only `other`, English `one` and `other`). The category is chosen
// by the `count` parameter; numbers are formatted for the locale. `{name}` is replaced by params.
export type Message = string | ({ readonly other: string } & Partial<Record<Intl.LDMLPluralRule, string>>)

export type TranslateParams = Readonly<Record<string, string | number>>

// Deliberately small: typed dictionaries, plurals and `t(key, params)`. Swap for a full i18n
// library (ICU, lazy loading) behind the same `useI18n()` shape when the app needs it.
export function createI18n<const Locale extends string, Key extends string>(config: {
  readonly dictionaries: Record<Locale, Record<Key, Message>>
  readonly defaultLocale: NoInfer<Locale>
  // localStorage key for the user's choice. Without a stored choice, the browser's languages pick.
  readonly storageKey: string
}) {
  const locales = Object.keys(config.dictionaries).filter(
    (value): value is Locale => value in config.dictionaries,
  )
  const Context = createContext<
    | {
        readonly locale: Locale
        readonly locales: ReadonlyArray<Locale>
        readonly setLocale: (locale: Locale) => void
        readonly t: (key: Key, params?: TranslateParams) => string
      }
    | undefined
  >(undefined)

  function I18nProvider(props: { readonly children: ReactNode }) {
    const [locale, setLocaleState] = useState(() => initialLocale(locales, config))
    // Screen readers pick their voice, and CSS `:lang()` its line height, from <html lang>.
    useEffect(() => {
      document.documentElement.lang = locale
    }, [locale])
    const value = useMemo(() => {
      const plurals = new Intl.PluralRules(locale)
      const numbers = new Intl.NumberFormat(locale)
      return {
        locale,
        locales,
        setLocale: (next: Locale) => {
          setLocaleState(next)
          writeStored(config.storageKey, next)
        },
        t: (key: Key, params?: TranslateParams) => {
          const message = config.dictionaries[locale][key]
          const template =
            typeof message === "string"
              ? message
              : (message[plurals.select(Number(params?.count ?? 0))] ?? message.other)
          return interpolate(template, params ?? {}, numbers)
        },
      }
    }, [locale])
    return <Context value={value}>{props.children}</Context>
  }

  function useI18n() {
    const value = useContext(Context)
    if (value === undefined) throw new Error("useI18n must be used inside I18nProvider")
    return value
  }

  function useT() {
    return useI18n().t
  }

  return { I18nProvider, useI18n, useT, locales }
}

function initialLocale<Locale extends string>(
  locales: ReadonlyArray<Locale>,
  config: { readonly defaultLocale: Locale; readonly storageKey: string },
) {
  const stored = locales.find((locale) => locale === readStored(config.storageKey))
  if (stored !== undefined) return stored
  // Outside a browser (tests, server render) there may be no navigator, or one without languages.
  const languages: ReadonlyArray<string> = typeof navigator === "undefined" ? [] : (navigator.languages ?? [])
  const preferred = languages
    .map((language) => language.toLowerCase().split("-")[0])
    .flatMap((language) => locales.filter((locale) => locale === language))
  return preferred[0] ?? config.defaultLocale
}

// localStorage throws in some browsers (blocked site data, sandboxed frames); a remembered
// language is a convenience, so a failure just means the browser's language is used next time.
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

function interpolate(template: string, params: TranslateParams, numbers: Intl.NumberFormat) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    return typeof value === "number" ? numbers.format(value) : value
  })
}
