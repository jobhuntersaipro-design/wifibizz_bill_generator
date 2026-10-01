"use client"

import * as React from "react"
import { Select as ArcSelect } from "@/components/arc/components/select/select"
import { useIsArc } from "@/components/design/use-design"
import bridge from "./arc/bridge.module.css"

/**
 * A native <select> in Classic — rendered exactly as the call site wrote it —
 * and Arc's Select in Arc: its rolling value, chevron and listbox. Callers keep
 * writing <option>s and reading `e.target.value`; the Arc branch reads the
 * options out of the children and hands back a change event with that shape.
 */

type Option = { value: string; label: string; disabled?: boolean }

/** Radix Select reserves the empty string, which native selects use for "none". */
const EMPTY = "__bf_empty__"
const toArc = (value: string) => (value === "" ? EMPTY : value)
const fromArc = (value: string) => (value === EMPTY ? "" : value)

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ""
}

function optionsOf(children: React.ReactNode, into: Option[] = []): Option[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: string | number; disabled?: boolean; children?: React.ReactNode }
    if (child.type === "option") {
      const label = textOf(props.children)
      into.push({ value: toArc(props.value === undefined ? label : String(props.value)), label, disabled: props.disabled })
    } else {
      optionsOf(props.children, into) // <optgroup>, fragments
    }
  })
  return into
}

function Select({ className, children, value, defaultValue, onChange, disabled, id, name, ...rest }: React.ComponentProps<"select">) {
  const arc = useIsArc()
  if (!arc) {
    return (
      <select className={className} value={value} defaultValue={defaultValue} onChange={onChange} disabled={disabled} id={id} name={name} {...rest}>
        {children}
      </select>
    )
  }
  const label = rest["aria-label"] ?? name ?? "Select"
  return (
    <div className={bridge.selectField}>
      <ArcSelect
        label={label}
        id={id}
        name={name}
        disabled={disabled}
        className={className}
        options={optionsOf(children)}
        value={value === undefined ? undefined : toArc(String(value))}
        defaultValue={defaultValue === undefined ? undefined : toArc(String(defaultValue))}
        onValueChange={(next) => {
          const target = { value: fromArc(next), name: name ?? "" }
          onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>)
        }}
      />
    </div>
  )
}

export { Select }
