import type { ComponentProps } from "react"
import { cn } from "./cn.ts"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md"

const base =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none " +
  "transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-focus",
  secondary:
    "border border-hairline bg-surface-1 text-ink hover:border-hairline-strong hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3",
  danger: "border border-hairline bg-surface-1 text-danger hover:border-hairline-strong hover:bg-surface-2",
}

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-dense",
  md: "h-8 px-3.5 text-body-sm max-md:h-9",
}

// Exported so links (TanStack <Link>, <a>) can look like buttons and stay links.
export function buttonClass(
  options: { variant?: ButtonVariant; size?: ButtonSize; className?: string | undefined } = {},
): string {
  return cn(base, variants[options.variant ?? "secondary"], sizes[options.size ?? "md"], options.className)
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant, size, className, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass({
        ...(variant ? { variant } : {}),
        ...(size ? { size } : {}),
        className,
      })}
      {...props}
    />
  )
}

export interface IconButtonProps extends ComponentProps<"button"> {
  // Required: an icon-only button needs a name for screen readers.
  label: string
  size?: ButtonSize
}

export function IconButton({ label, size = "md", className, type, ...props }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        base,
        variants.ghost,
        size === "sm" ? "size-7" : "size-8 max-md:size-9",
        "rounded-md p-0",
        className,
      )}
      {...props}
    />
  )
}
