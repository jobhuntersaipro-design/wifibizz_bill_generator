"use client"

import * as React from "react"
import SegmentedControl from "@/components/arc/components/segmented-control/segmented-control"
import { useIsArc } from "@/components/design/use-design"

interface SegmentedProps {
  /** Accessible name of the group in Arc. */
  label: string
  /** `count` renders after the label, dimmed, the way the Classic chips show it. */
  options: ReadonlyArray<{ value: string; label: string; count?: number }>
  /** No option matches (e.g. a custom range is active) → nothing reads as selected. */
  value: string
  onValueChange: (value: string) => void
  className?: string
  /** The toggle exactly as Classic draws it. */
  classic: React.ReactNode
}

/**
 * A single-choice toggle (granularity, date field, preset ranges, chips). Classic
 * renders the caller's own buttons untouched; Arc renders Arc's SegmentedControl,
 * with its sliding selection and arrow-key movement.
 */
export function Segmented({ label, options, value, onValueChange, className, classic }: SegmentedProps) {
  const arc = useIsArc()
  if (!arc) return <>{classic}</>
  return (
    <SegmentedControl
      label={label}
      options={options.map((o) => ({
        value: o.value,
        label: o.label,
        accessory: o.count === undefined ? undefined : <span className="ml-1 tabular-nums opacity-70">{o.count}</span>,
      }))}
      value={value}
      onValueChange={onValueChange}
      className={className}
    />
  )
}
