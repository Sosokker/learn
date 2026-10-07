// Small Web Crypto helpers shared by auth and services (Workers, Node and Bun all have them).

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
}

// UUIDv7: 48-bit ms timestamp then random bits, so ids sort by creation time (RFC 9562).
export function uuidv7(now = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff
  b[6] = ((b[6] as number) & 0x0f) | 0x70
  b[8] = ((b[8] as number) & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// An API token: a recognizable prefix plus 32 random bytes, base64url.
export function newApiToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return `lrn_${btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`
}
