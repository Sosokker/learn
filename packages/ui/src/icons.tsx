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

export function SunIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
    </svg>
  )
}

export function MoonIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <path d="M13 9.6A5.25 5.25 0 0 1 6.4 3a5.25 5.25 0 1 0 6.6 6.6z" />
    </svg>
  )
}

export function MonitorIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <rect x="2" y="2.75" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11.25V14" />
    </svg>
  )
}

// A large and a small "A": the lesson text size.
export function TextSizeIcon(props: { readonly className?: string }) {
  return (
    <svg {...common} aria-hidden className={props.className}>
      <path d="M1.75 13 5.5 3.5 9.25 13M3.1 9.75h4.8M10 13l2.25-5.5L14.5 13M10.8 11.1h2.9" />
    </svg>
  )
}
