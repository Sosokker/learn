import { type ReactNode, useId } from "react"
import { cn } from "./cn.ts"

export interface SegmentedOption<V extends string> {
  readonly value: V
  readonly label: ReactNode
  readonly title?: string
}

export interface SegmentedControlProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: ReadonlyArray<SegmentedOption<V>>
  label: string
  size?: "sm" | "md"
  className?: string
}

// Linear's pill toggle, built on native radios: arrow keys, focus and screen readers come free.
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: SegmentedControlProps<V>) {
  const name = useId()
  return (
    <fieldset
      className={cn(
        "m-0 inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-md border border-hairline bg-canvas p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <label
            key={o.value}
            title={o.title}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1 rounded-sm font-medium whitespace-nowrap transition-colors duration-100",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary-focus/50",
              size === "sm" ? "h-6 px-2 text-caption" : "h-7 px-2.5 text-dense max-md:h-8",
              selected ? "bg-surface-3 text-ink" : "text-ink-subtle hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        )
      })}
    </fieldset>
  )
}
