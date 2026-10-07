// Keyset cursors: the sort key of the last row, opaque to clients. Never OFFSET: D1 bills every
// row scanned, and an offset scans all the rows it skips.
export function encodeCursor(key: ReadonlyArray<string | number | null>): string {
  return btoa(JSON.stringify(key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function decodeCursor(cursor: string | undefined): Array<unknown> | null {
  if (cursor === undefined || cursor === "") return null
  try {
    const v: unknown = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")))
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
