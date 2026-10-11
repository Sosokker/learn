import { useId } from "react"

// Flags as inline SVG, not emoji: Windows has no flag emoji and shows the letters "GB" / "TH".
// Decorative: the button around a flag carries the language name. Each flag is 18x12 (3:2),
// with a faint inner edge so the white stripes stay visible on a light surface.
const frame = "inline-block h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-ink/15 ring-inset"

// English: the United Kingdom flag. The language is named after England; Thai schools teach
// British English first, so it is the flag most readers here expect.
export function GbFlag() {
  // Clip paths need ids unique on the page; the switch can be mounted more than once.
  const id = useId()
  return (
    <span aria-hidden className={frame}>
      <svg
        aria-hidden
        viewBox="0 0 60 30"
        width="18"
        height="12"
        preserveAspectRatio="xMidYMid slice"
        className="block"
      >
        <clipPath id={`${id}s`}>
          <path d="M0,0 v30 h60 v-30 z" />
        </clipPath>
        <clipPath id={`${id}t`}>
          <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
        </clipPath>
        <g clipPath={`url(#${id}s)`}>
          <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}t)`} stroke="#C8102E" strokeWidth="4" />
          <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
        </g>
      </svg>
    </span>
  )
}

// Thai: five stripes, red-white-blue-white-red, the blue twice as tall.
export function ThFlag() {
  return (
    <span aria-hidden className={frame}>
      <svg aria-hidden viewBox="0 0 18 12" width="18" height="12" className="block">
        <rect width="18" height="12" fill="#A51931" />
        <rect y="2" width="18" height="8" fill="#F4F5F8" />
        <rect y="4" width="18" height="4" fill="#2D2A4A" />
      </svg>
    </span>
  )
}
