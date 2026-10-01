"use client"

import * as React from "react"
import { useIsArc } from "@/components/design/use-design"
import { Label as ClassicLabel } from "./classic/label"
import { cx } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  const arc = useIsArc()
  return <ClassicLabel {...props} className={cx(arc && bridge.label, className)} />
}

export { Label }
