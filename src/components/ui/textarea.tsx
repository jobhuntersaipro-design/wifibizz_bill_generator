"use client"

import * as React from "react"
import arcTextarea from "@/components/arc/components/textarea/textarea.module.css"
import { useIsArc } from "@/components/design/use-design"
import { cx } from "./arc/shared"

/**
 * A <textarea> that keeps its own classes in Classic and takes Arc's Textarea
 * control styling in Arc. Same element in both, so typing survives a design flip.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const arc = useIsArc()
  return <textarea {...props} className={cx(arc && arcTextarea.control, className) || undefined} />
}

export { Textarea }
