import { type ComponentProps, type ReactNode, useId } from "react"
import { cn } from "./cn.ts"
import { ChevronDownIcon } from "./icons.tsx"

// 16px text below md stops iOS Safari from zooming into a focused field.
const control =
  "w-full rounded-md border border-hairline bg-surface-1 text-ink placeholder:text-ink-tertiary " +
  "transition-colors duration-100 hover:border-hairline-strong focus:border-hairline-strong " +
  "disabled:opacity-50 aria-[invalid=true]:border-danger text-body-sm max-md:text-body"

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-8 px-3 max-md:h-10", className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 px-3 py-2 leading-normal", className)} {...props} />
}

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface SelectProps extends Omit<ComponentProps<"select">, "children"> {
  options: ReadonlyArray<SelectOption>
}

// A native select: the platform picker is the most usable one on phones and with screen readers.
export function Select({ options, className, ...props }: SelectProps) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select className={cn(control, "h-8 cursor-pointer appearance-none pr-8 pl-3 max-md:h-10")} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-subtle" />
    </span>
  )
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  // Gets the generated id so the control can point its label and description at it.
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const describedBy = error || hint ? hintId : undefined
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-dense font-medium text-ink-muted">
        {label}
      </label>
      {children({ id, describedBy })}
      {error ? (
        <p id={hintId} className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
