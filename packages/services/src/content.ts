// Content addressing: a published body is stored once, at c/<sha256>.json, and never changes.
// The same key is the public URL path (`/c/<hash>.json`), cached at the edge for a year.

export const contentKey = (hash: string) => `c/${hash}.json`

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

// The exact bytes that are hashed and stored: the decoded spec re-serialized, so formatting
// differences in what pi sent do not make a new body.
export const canonicalJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
