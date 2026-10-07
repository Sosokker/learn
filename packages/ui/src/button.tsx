import { Button as BaseButton } from "@base-ui/react/button"
import type { ComponentProps } from "react"
import { cx } from "./cx.ts"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg" | "icon"

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50"

const variants: Record<ButtonVariant, string> = {
  // Lavender is reserved for the one main action on a screen.
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed",
  secondary: "border border-hairline bg-surface-1 text-ink hover:border-hairline-strong hover:bg-surface-3",
  ghost: "text-ink-muted hover:bg-surface-3 hover:text-ink",
  danger: "border border-hairline bg-surface-1 text-danger hover:border-danger/50 hover:bg-danger/10",
}

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-dense",
  md: "h-8 px-3.5 text-body-sm",
  lg: "h-10 px-4 text-body-sm",
  // Square, for an icon alone; give it an aria-label.
  icon: "size-8 text-body-sm",
}

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return cx(base, variants[variant], sizes[size])
}

// Base UI Button: renders a <button type="button"> by default; pass `render={<a href=… />}`
// (or a router Link) to get a link that looks like a button.
export function Button(
  props: Omit<ComponentProps<typeof BaseButton>, "className"> & {
    readonly variant?: ButtonVariant
    readonly size?: ButtonSize
    readonly className?: string
  },
) {
  const { variant, size, className, ...rest } = props
  return <BaseButton {...rest} className={cx(buttonClass(variant, size), className)} />
}
