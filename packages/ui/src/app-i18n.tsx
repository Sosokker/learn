import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import type { ReactNode } from "react"
import { GbFlag, ThFlag } from "./flags.tsx"
import { createI18n } from "./i18n.tsx"
import { en, th } from "./messages.ts"
import { Tooltip } from "./tooltip.tsx"

// The app's i18n: English and Thai, remembered in localStorage, sets <html lang>.
// Wrap the app in <I18nProvider>; read text with `const t = useT(); t("nav.library")`.
export const { I18nProvider, useI18n, useT, locales } = createI18n({
  dictionaries: { en, th },
  defaultLocale: "en",
  storageKey: "learn.lang",
})

export type Locale = (typeof locales)[number]

const endonyms: Record<Locale, string> = { en: en["lang.en"], th: en["lang.th"] }
const flags: Record<Locale, ReactNode> = { en: <GbFlag />, th: <ThFlag /> }

// Language switch as two flag buttons. The flag is decoration; each button is named by the
// language in its own script ("English", "ไทย"), so a user who cannot read the current language
// still finds theirs. The chosen one is pressed (aria-pressed).
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n()
  return (
    <ToggleGroup
      aria-label={t("lang.label")}
      value={[locale]}
      onValueChange={(values) => {
        const next = locales.find((value) => values.includes(value))
        if (next !== undefined) setLocale(next)
      }}
      className="inline-flex rounded-md border border-hairline p-0.5"
    >
      {locales.map((value) => (
        <Tooltip key={value} content={<span lang={value}>{endonyms[value]}</span>}>
          <Toggle
            value={value}
            lang={value}
            aria-label={endonyms[value]}
            className="flex h-7 w-9 items-center justify-center rounded-sm opacity-55 grayscale-[60%] transition hover:opacity-100 hover:grayscale-0 data-[pressed]:bg-surface-4 data-[pressed]:opacity-100 data-[pressed]:grayscale-0"
          >
            {flags[value]}
          </Toggle>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
