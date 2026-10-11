import { Menu as BaseMenu } from "@base-ui/react/menu"
import type { ReactNode } from "react"
import { LanguageSwitch, useI18n } from "./app-i18n.tsx"
import { Button } from "./button.tsx"
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon, TextSizeIcon } from "./icons.tsx"
import { itemClass, popupClass } from "./popup.ts"
import { setPreference, type TextSize, type Theme, textSizes, themes, usePreferences } from "./preferences.ts"
import { Tooltip } from "./tooltip.tsx"

// The reader's display controls in one row: language, theme, lesson text size.
export function DisplayTools(props: { readonly side?: "top" | "bottom" }) {
  const { t } = useI18n()
  return (
    <fieldset className="m-0 flex min-w-0 items-center justify-between gap-2 border-0 p-0">
      <legend className="sr-only">{t("tools.label")}</legend>
      <LanguageSwitch />
      <div className="flex items-center gap-0.5">
        <ThemeMenu side={props.side} />
        <TextSizeMenu side={props.side} />
      </div>
    </fieldset>
  )
}

const themeIcons: Record<Theme, ReactNode> = {
  system: <MonitorIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
}

export function ThemeMenu(props: { readonly side?: "top" | "bottom" | undefined }) {
  const { t } = useI18n()
  const { theme } = usePreferences()
  return (
    <ChoiceMenu
      label={t("theme.label")}
      current={t(`theme.${theme}`)}
      icon={themeIcons[theme]}
      side={props.side}
      value={theme}
      options={themes.map((value) => ({ value, label: t(`theme.${value}`), icon: themeIcons[value] }))}
      onChange={(value) => setPreference("theme", value)}
    />
  )
}

// Sample glyphs at the size each option gives, so the choice is visible before it is made.
const sampleSizes: Record<TextSize, string> = { sm: "text-caption", md: "text-body-sm", lg: "text-body" }

export function TextSizeMenu(props: { readonly side?: "top" | "bottom" | undefined }) {
  const { t } = useI18n()
  const { textSize } = usePreferences()
  return (
    <ChoiceMenu
      label={t("textSize.label")}
      current={t(`textSize.${textSize}`)}
      icon={<TextSizeIcon />}
      side={props.side}
      value={textSize}
      options={textSizes.map((value) => ({
        value,
        label: t(`textSize.${value}`),
        icon: (
          <span
            aria-hidden
            className={`inline-block w-4 text-center font-medium leading-none ${sampleSizes[value]}`}
          >
            A
          </span>
        ),
      }))}
      onChange={(value) => setPreference("textSize", value)}
    />
  )
}

// An icon button that opens a single-choice menu. The button's name says the setting and its
// current value ("Theme: Dark"), since the icon alone does not reach a screen reader.
function ChoiceMenu<V extends string>(props: {
  readonly label: string
  readonly current: string
  readonly icon: ReactNode
  readonly side: "top" | "bottom" | undefined
  readonly value: V
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: string; readonly icon: ReactNode }>
  readonly onChange: (value: V) => void
}) {
  const name = `${props.label}: ${props.current}`
  return (
    <BaseMenu.Root>
      <Tooltip content={name} side={props.side === "bottom" ? "bottom" : "top"}>
        <BaseMenu.Trigger render={<Button variant="ghost" size="icon" aria-label={name} />}>
          {props.icon}
        </BaseMenu.Trigger>
      </Tooltip>
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          side={props.side ?? "top"}
          align="end"
          sideOffset={4}
          className="z-50 outline-none"
        >
          <BaseMenu.Popup className={popupClass}>
            <BaseMenu.Group>
              <BaseMenu.GroupLabel className="px-2 py-1 text-caption font-medium text-ink-tertiary">
                {props.label}
              </BaseMenu.GroupLabel>
              <BaseMenu.RadioGroup
                value={props.value}
                onValueChange={(next: unknown) => {
                  const option = props.options.find((candidate) => candidate.value === next)
                  if (option !== undefined) props.onChange(option.value)
                }}
              >
                {props.options.map((option) => (
                  <BaseMenu.RadioItem
                    key={option.value}
                    value={option.value}
                    closeOnClick
                    className={itemClass}
                  >
                    <span className="flex w-4 justify-center text-ink-subtle">{option.icon}</span>
                    <span className="flex-1 truncate">{option.label}</span>
                    <BaseMenu.RadioItemIndicator className="text-ink">
                      <CheckIcon />
                    </BaseMenu.RadioItemIndicator>
                  </BaseMenu.RadioItem>
                ))}
              </BaseMenu.RadioGroup>
            </BaseMenu.Group>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
