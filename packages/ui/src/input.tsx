import { Field } from "@base-ui/react/field"
import { Input as BaseInput } from "@base-ui/react/input"
import type { ComponentProps, ReactNode } from "react"
import { cx } from "./cx.ts"

export const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-hairline bg-surface-1 px-3 text-body-sm text-ink transition-colors placeholder:text-ink-tertiary hover:border-hairline-strong focus-visible:border-accent focus-visible:outline-none data-[invalid]:border-danger data-[disabled]:opacity-50"

// A bare input. Give it a visible <label> or an aria-label; use TextField for a labelled one.
export function Input(
  props: Omit<ComponentProps<typeof BaseInput>, "className"> & { readonly className?: string },
) {
  const { className, ...rest } = props
  return <BaseInput {...rest} className={cx(inputClass, className)} />
}

// A labelled input with an optional hint and the field's error message (browser validity, or the
// server's message passed through a Base UI Form's `errors`).
export function TextField(props: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly hint?: ReactNode
  readonly placeholder?: string
  readonly type?: "text" | "email" | "search" | "url"
  readonly required?: boolean
  readonly disabled?: boolean
  readonly multiline?: boolean
  readonly autoComplete?: string
}) {
  const multiline = props.multiline === true
  return (
    <Field.Root name={props.name} disabled={props.disabled ?? false} className="flex flex-col gap-1.5">
      <Field.Label className="text-dense font-medium text-ink-muted">{props.label}</Field.Label>
      <Field.Control
        value={props.value}
        required={props.required ?? false}
        placeholder={props.placeholder}
        type={multiline ? undefined : (props.type ?? "text")}
        autoComplete={props.autoComplete}
        onValueChange={props.onValueChange}
        className={multiline ? cx(inputClass, "h-auto min-h-20 resize-y py-2") : inputClass}
        render={multiline ? <textarea /> : <input />}
      />
      {props.hint === undefined ? null : (
        <Field.Description className="text-caption text-ink-subtle">{props.hint}</Field.Description>
      )}
      <Field.Error className="text-caption text-danger" />
    </Field.Root>
  )
}
