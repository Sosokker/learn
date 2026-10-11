// The server publish.ts sends the token to. The token is a bearer credential, so it goes over
// https only; plain http is allowed for a local dev server (localhost, 127.0.0.1, [::1],
// *.localhost), where nothing leaves the machine. Returns the origin, or why it is refused.
export const publishOrigin = (
  raw: string,
): { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly reason: string } => {
  const parsed = URL.canParse(raw) ? new URL(raw) : undefined
  if (parsed === undefined || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    return { ok: false, reason: `--url / LEARN_URL "${raw}" is not an http(s) URL` }
  }
  const host = parsed.hostname
  const local =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  if (parsed.protocol === "http:" && !local) {
    return {
      ok: false,
      reason: `refusing to send the API token over plain http to ${host}: use https (http is allowed only for localhost, 127.0.0.1, [::1] and *.localhost)`,
    }
  }
  return { ok: true, origin: parsed.origin }
}
