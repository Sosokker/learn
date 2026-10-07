import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { createI18n } from "./i18n.tsx"
import { en, th } from "./messages.ts"

// The app's i18n: English and Thai, remembered in localStorage, sets <html lang>.
// Wrap the app in <I18nProvider>; read text with `const t = useT(); t("nav.library")`.
export const { I18nProvider, useI18n, useT, locales } = createI18n({
  dictionaries: { en, th },
  defaultLocale: "en",
  storageKey: "learn.lang",
})

export type Locale = (typeof locales)[number]

const endonyms: Record<Locale, string> = { en: en["lang.en"], th: en["lang.th"] }

// EN / ไทย switch. Each language is labelled in its own script so a user who cannot read the
// current language still finds theirs.
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
        <Toggle
          key={value}
          value={value}
          lang={value}
          className="h-6 rounded-sm px-2 text-caption font-medium text-ink-subtle hover:text-ink data-[pressed]:bg-surface-4 data-[pressed]:text-ink"
        >
          {endonyms[value]}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
