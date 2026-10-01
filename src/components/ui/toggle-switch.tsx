"use client"

import * as React from "react"
import { Switch as ArcSwitch } from "@/components/arc/components/switch/switch"
import { useIsArc } from "@/components/design/use-design"

interface ToggleSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name; there is no visible label beside the switch. */
  "aria-label": string
  disabled?: boolean
  className?: string
  /** The switch exactly as Classic draws it. */
  classic: React.ReactNode
}

/** An on/off switch: the caller's own markup in Classic, Arc's Switch in Arc. */
export function ToggleSwitch({ classic, ...props }: ToggleSwitchProps) {
  const arc = useIsArc()
  if (!arc) return <>{classic}</>
  return <ArcSwitch {...props} />
}
