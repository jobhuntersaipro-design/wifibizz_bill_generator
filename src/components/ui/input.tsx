"use client"

import * as React from "react"
import arcInput from "@/components/arc/components/input/input.module.css"
import { useIsArc } from "@/components/design/use-design"
import { Input as ClassicInput } from "./classic/input"
import bridge from "./arc/bridge.module.css"
import { cx } from "./arc/shared"

/**
 * The same element renders in both designs and only its classes change, so
 * flipping the design mid-form never remounts a field or loses what was typed.
 * In Arc the field takes Arc's own Input control styling (`input.module.css`);
 * Arc's Input component also renders a <label>, which this app already draws
 * separately with <Label>, so the control's class is used rather than the
 * wrapper. `unstyled` is for fields that were a plain <input> with their own classes.
 */
const PAD_START = /(^|\s)([a-z0-9]+:)*(pl|ps)-/
const PAD_END = /(^|\s)([a-z0-9]+:)*(pr|pe)-/

/** Keeps a caller's pl-N or pr-N (room for an icon inside the field) over Arc's padding. */
function padClasses(className: string | undefined) {
  if (!className) return undefined
  return cx(PAD_START.test(className) && bridge.keepPadStart, PAD_END.test(className) && bridge.keepPadEnd)
}

function Input({ className, unstyled, ...props }: React.ComponentProps<"input"> & { unstyled?: boolean }) {
  const arc = useIsArc()
  const classes = cx(arc && arcInput.input, arc && padClasses(className), className)
  if (unstyled) return <input {...props} className={classes || undefined} />
  return <ClassicInput {...props} className={classes} />
}

export { Input }
