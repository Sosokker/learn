// Shared look for floating panels (select, menu): a raised surface with a hairline, no shadow.
export const popupClass =
  "min-w-40 rounded-lg border border-hairline-strong bg-surface-2 p-1 text-body-sm text-ink outline-none origin-[var(--transform-origin)] transition-[transform,opacity] duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"

export const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-ink-muted outline-none data-[highlighted]:bg-surface-4 data-[highlighted]:text-ink data-[disabled]:opacity-50"
