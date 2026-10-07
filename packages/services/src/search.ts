// Search text for FTS5. The `unicode61` tokenizer splits on spaces and punctuation, and Thai is
// written without spaces between words, so Thai text is split into words with
// Intl.Segmenter('th') before it is indexed, and the query is split the same way. Workerd ships
// the ICU word dictionary for Thai (checked by apps/worker/test/workerd.test.ts). Words outside
// the dictionary (e.g. นิวตัน) split into pieces, but the same pieces on both sides, so they match.

const thai = /[฀-๿]/u
const segmenter = new Intl.Segmenter("th", { granularity: "word" })

export const searchWords = (text: string): ReadonlyArray<string> =>
  Array.from(segmenter.segment(text.normalize("NFC")))
    .filter((segment) => segment.isWordLike === true)
    .map((segment) => segment.segment.toLowerCase())

// The text stored in the FTS column: words separated by spaces. Non-Thai text passes through
// unchanged, so unicode61 handles it as usual.
export const searchText = (text: string): string => (thai.test(text) ? searchWords(text).join(" ") : text)

// A MATCH expression: every word must appear; the last one may be a prefix (search as you type).
// Each word is a quoted FTS5 string, so operators and syntax in user input are inert.
export const ftsQuery = (query: string): string | undefined => {
  const words = searchWords(query)
  if (words.length === 0) return undefined
  return words
    .map((word, index) => `"${word.replaceAll('"', '""')}"${index === words.length - 1 ? "*" : ""}`)
    .join(" ")
}
