import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { I18nProvider } from "../src/app-i18n.tsx"
import { DisplayTools } from "../src/display-tools.tsx"
import { parsePreferences, resolveTheme, rootAttributes } from "../src/preferences.ts"

describe("preferences", () => {
  it("falls back to the system theme and default size for missing or unknown values", () => {
    expect(parsePreferences({ theme: null, textSize: null })).toEqual({ theme: "system", textSize: "md" })
    expect(parsePreferences({ theme: "sepia", textSize: "xxl" })).toEqual({ theme: "system", textSize: "md" })
    expect(parsePreferences({ theme: "light", textSize: "lg" })).toEqual({ theme: "light", textSize: "lg" })
  })

  it("sets data-theme only for a chosen theme and data-text-size only off the default", () => {
    expect(rootAttributes({ theme: "system", textSize: "md" })).toEqual({
      "data-theme": null,
      "data-text-size": null,
    })
    expect(rootAttributes({ theme: "light", textSize: "sm" })).toEqual({
      "data-theme": "light",
      "data-text-size": "sm",
    })
    expect(rootAttributes({ theme: "dark", textSize: "lg" })).toEqual({
      "data-theme": "dark",
      "data-text-size": "lg",
    })
  })

  it("resolves system to the color scheme the system prefers", () => {
    expect(resolveTheme("system", true)).toBe("light")
    expect(resolveTheme("system", false)).toBe("dark")
    expect(resolveTheme("dark", true)).toBe("dark")
    expect(resolveTheme("light", false)).toBe("light")
  })
})

describe("display tools", () => {
  // Outside a browser: no stored choice, no navigator languages, so English and the defaults.
  const html = renderToString(
    <I18nProvider>
      <DisplayTools />
    </I18nProvider>,
  )

  it("labels each flag with its language, in its own script, and marks the current one", () => {
    expect(html).toMatch(/role="group" aria-label="Language"/)
    expect(html).toMatch(/<button[^>]*aria-pressed="true" lang="en" aria-label="English"/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false" lang="th" aria-label="ไทย"/)
    // Flags are decoration: the SVGs are hidden from assistive tech.
    expect(html).toMatch(/aria-label="English"[^>]*><span aria-hidden="true"/)
    expect(html).not.toMatch(/>GB<|>TH</)
  })

  it("names the theme and text size buttons with their current value", () => {
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Display<\/legend>/)
    expect(html).toMatch(/aria-label="Theme: System" aria-haspopup="menu"/)
    expect(html).toMatch(/aria-label="Lesson text size: Default" aria-haspopup="menu"/)
  })
})
