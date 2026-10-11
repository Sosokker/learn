// Server-Sent Events framing for job progress. `id` lets EventSource resume with Last-Event-ID.
export const sseFrame = (seq: number, data: string) => `id: ${seq}\ndata: ${data}\n\n`

// A comment line: keeps proxies from closing an idle stream.
export const ssePing = ": ping\n\n"

export const sseHeaders = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const
