import { test as base, expect, type Page } from "@playwright/test"

// Every page test fails on a console error or an uncaught exception. Signed out, the app asks
// /api/me and gets the expected 401, which Chrome logs as a failed resource; that one is allowed.
const expected = (text: string, url: string): boolean =>
  /Failed to load resource/.test(text) && /\/api\/me(\?|$)/.test(url) && /401/.test(text)

export const test = base.extend<{ consoleErrors: Array<string> }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: Array<string> = []
      page.on("console", (msg) => {
        if (msg.type() !== "error") return
        const url = msg.location().url
        if (!expected(msg.text(), url)) errors.push(`${msg.text()} (${url})`)
      })
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
      await use(errors)
      expect(errors, "console errors").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Open the guide and wait until the lesson body has rendered. */
export const openGuide = async (page: Page, path = "/guide"): Promise<void> => {
  await page.goto(path)
  await expect(page.locator(".lsn #section-problem")).toBeVisible()
}
