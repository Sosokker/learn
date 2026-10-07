// The few glyphs the base components need, as inline SVG that follows currentColor. Apps bring
// their own icon set for everything else.
const common = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

export function ChevronDownIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

export function CheckIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

export function CloseIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
