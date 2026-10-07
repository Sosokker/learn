import type { Param } from "@app/domain"
import { useId } from "react"
import { richText } from "../model.ts"
import { RichInline } from "../rich.tsx"

export const formatNumber = (lang: string, v: number, digits = 2): string =>
  Number.isFinite(v) ? new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v) : "–"

const stepDigits = (step: number): number => {
  const s = String(step)
  const dot = s.indexOf(".")
  return dot === -1 ? 0 : Math.min(4, s.length - dot - 1)
}

/** One slider for a widget param. The row carries the param's part for color and hover. */
export function ParamSlider(props: {
  readonly param: Param
  readonly value: number
  readonly lang: string
  readonly suffix?: string
  readonly onChange: (v: number) => void
}) {
  const p = props.param
  const id = useId()
  return (
    <div
      className="lsn-slider"
      data-p={p.part}
      data-target={p.part === undefined ? undefined : `part:${p.part}`}
    >
      <span className="lsn-slider-label">
        <RichInline src={p.label} />
      </span>
      <input
        id={id}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={props.value}
        aria-label={richText(p.label)}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <output htmlFor={id} className="lsn-slider-value">
        {formatNumber(props.lang, props.value, stepDigits(p.step))}
        {props.suffix ?? ""}
      </output>
    </div>
  )
}
