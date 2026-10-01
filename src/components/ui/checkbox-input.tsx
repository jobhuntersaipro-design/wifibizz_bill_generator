"use client"

import * as React from "react"
import { Checkbox as ArcCheckbox } from "@/components/arc/components/checkbox/checkbox"
import { useIsArc } from "@/components/design/use-design"

/**
 * A native checkbox in Classic, exactly as the call site wrote it, and Arc's
 * Checkbox (animated fill and check) in Arc. Callers keep `onChange` and
 * `e.target.checked`; the Arc branch hands back a change event with that shape.
 */
function CheckboxInput({ className, checked, defaultChecked, onChange, disabled, id, name, ...rest }: Omit<React.ComponentProps<"input">, "type">) {
  const arc = useIsArc()
  if (!arc) {
    return (
      <input
        type="checkbox"
        className={className}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        id={id}
        name={name}
        {...rest}
      />
    )
  }
  return (
    <ArcCheckbox
      id={id}
      name={name}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next) => {
        const target = { checked: next === true, name: name ?? "" }
        onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLInputElement>)
      }}
    />
  )
}

export { CheckboxInput }
