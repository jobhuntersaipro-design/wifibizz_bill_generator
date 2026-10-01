"use client"

import * as React from "react"
import { Checkbox as ArcCheckbox } from "@/components/arc/components/checkbox/checkbox"
import { useIsArc } from "@/components/design/use-design"
import { Checkbox as ClassicCheckbox } from "./classic/checkbox"
import { classOf } from "./arc/shared"

type Props = React.ComponentProps<typeof ClassicCheckbox>

function Checkbox(props: Props) {
  const arc = useIsArc()
  if (!arc) return <ClassicCheckbox {...props} />
  const { checked, defaultChecked, indeterminate, onCheckedChange, disabled, id, name, required, className } = props
  return (
    <ArcCheckbox
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      className={classOf(className)}
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      defaultChecked={defaultChecked}
      checked={indeterminate ? "indeterminate" : checked}
      // base-ui reports a boolean plus event details; callers here only read the boolean.
      onCheckedChange={onCheckedChange ? (next) => onCheckedChange(next === true, undefined as never) : undefined}
    />
  )
}

export { Checkbox }
