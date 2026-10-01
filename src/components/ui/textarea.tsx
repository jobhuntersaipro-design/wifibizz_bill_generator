"use client"

import * as React from "react"
import arcTextarea from "@/components/arc/components/textarea/textarea.module.css"
import { useIsArc } from "@/components/design/use-design"
import bridge from "./arc/bridge.module.css"
import { cx } from "./arc/shared"

const MIN_HEIGHT = /(^|\s)([a-z0-9-]+:)*min-h-/
const RESIZE = /(^|\s)([a-z0-9-]+:)*resize(-|\s|$)/

/**
 * A <textarea> that keeps its own classes in Classic and takes Arc's Textarea
 * control styling in Arc. Same element in both, so typing survives a design flip.
 * A caller's own min-h-* / resize-* win over Arc's (a one-line composer stays one line).
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const arc = useIsArc()
  const sized = arc && className ? cx(MIN_HEIGHT.test(className) && bridge.keepMinHeight, RESIZE.test(className) && bridge.keepResize) : undefined
  return <textarea {...props} className={cx(arc && arcTextarea.control, sized, className) || undefined} />
}

export { Textarea }
