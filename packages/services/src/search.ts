// FTS5's unicode61 tokenizer splits on spaces, and Thai has none between words. So text is split
// into words with Intl.Segmenter('th') (which handles Latin text too) before it is written to or
// matched against the FTS tables. workerd ships the Thai ICU data (checked 2026-10-07).

const segmenter = new Intl.Segmenter("th", { granularity: "word" })

export function words(text: string): Array<string> {
  return [...segmenter.segment(text.normalize("NFC"))].filter((s) => s.isWordLike).map((s) => s.segment)
}

export const searchText = (text: string): string => words(text).join(" ")

// A user query as an FTS5 expression: every word must match, the last one as a prefix, so search
// works while typing. Words are quoted, so FTS operators in the input are just text.
export function ftsQuery(q: string): string | null {
  const ws = words(q.toLowerCase()).slice(0, 8)
  if (ws.length === 0) return null
  return ws.map((w, i) => `"${w.replaceAll('"', "")}"${i === ws.length - 1 ? "*" : ""}`).join(" ")
}

// Tags are normalized so `Epsilon Delta` and `epsilon-delta` are one tag.
export function normalizeTag(t: string): string {
  return t
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
