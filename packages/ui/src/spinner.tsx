import { cx } from "./cx.ts"

// A loading indicator. `label` is announced to screen readers ("Loading lessons").
export function Spinner(props: {
  readonly label: string
  readonly size?: "sm" | "md"
  readonly className?: string
}) {
  const size = props.size === "sm" ? "size-3.5" : "size-5"
  return (
    <span role="status" className={cx("inline-flex text-ink-subtle", props.className)}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className={cx(size, "animate-spin motion-reduce:animate-[spin_2s_linear_infinite]")}
      >
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{props.label}</span>
    </span>
  )
}
