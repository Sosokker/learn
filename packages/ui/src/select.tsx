import { Select as BaseSelect } from "@base-ui/react/select"
import { cx } from "./cx.ts"
import { CheckIcon, ChevronDownIcon } from "./icons.tsx"
import { inputClass } from "./input.tsx"
import { itemClass, popupClass } from "./popup.ts"

export type SelectOption<Value extends string> = { readonly value: Value; readonly label: string }

// A single-choice select (Base UI): keyboard, typeahead and screen readers work. The popup lines
// the selected item up with the trigger, like a native select. `label` names it for assistive
// tech; set `hideLabel` when the context already shows what it is.
export function Select<const Value extends string>(props: {
  readonly label: string
  readonly options: ReadonlyArray<SelectOption<Value>>
  readonly value: Value
  readonly onValueChange: (value: Value) => void
  readonly hideLabel?: boolean
  readonly disabled?: boolean
  readonly className?: string
}) {
  return (
    <BaseSelect.Root
      items={props.options}
      value={props.value}
      disabled={props.disabled ?? false}
      onValueChange={(value) => {
        const next = props.options.find((option) => option.value === value)
        if (next !== undefined) props.onValueChange(next.value)
      }}
    >
      <div className={cx("flex flex-col gap-1.5", props.className)}>
        <BaseSelect.Label
          className={props.hideLabel === true ? "sr-only" : "text-dense font-medium text-ink-muted"}
        >
          {props.label}
        </BaseSelect.Label>
        <BaseSelect.Trigger className={cx(inputClass, "flex items-center justify-between gap-2 text-left")}>
          <BaseSelect.Value className="truncate" />
          <BaseSelect.Icon className="text-ink-subtle">
            <ChevronDownIcon />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50 outline-none">
          <BaseSelect.Popup className={cx(popupClass, "min-w-[var(--anchor-width)]")}>
            <BaseSelect.List className="max-h-[var(--available-height)] overflow-y-auto">
              {props.options.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} className={itemClass}>
                  <BaseSelect.ItemText className="flex-1 truncate">{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-accent">
                    <CheckIcon />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
