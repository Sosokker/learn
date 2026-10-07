// Tags as the author types them become one canonical slug: NFC, lowercase, runs of anything but
// letters, marks and digits become one dash. Thai letters stay (a Thai tag is a Thai slug).
export const normalizeTag = (input: string): string =>
  input
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
