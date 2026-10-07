import { readFileSync } from "node:fs"
import type { BrowserContext } from "@playwright/test"
import { sessionFile } from "./global-setup.ts"

// Signs the browser in as the e2e user (see global-setup.ts) by setting the session cookie.
export async function signIn(context: BrowserContext) {
  const { name, value } = JSON.parse(readFileSync(sessionFile, "utf8")) as { name: string; value: string }
  await context.addCookies([{ name, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }])
}
