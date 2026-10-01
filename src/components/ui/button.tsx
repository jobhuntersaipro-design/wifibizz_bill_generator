"use client"

import * as React from "react"
import { Button as ArcButton, type ButtonProps as ArcButtonProps } from "@/components/arc/components/button/button"
import { useIsArc } from "@/components/design/use-design"
import { Button as ClassicButton, buttonVariants } from "./classic/button"
import { classOf, cx, omit } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

type ClassicProps = React.ComponentProps<typeof ClassicButton>
type Variant = NonNullable<ClassicProps["variant"]>
type Size = NonNullable<ClassicProps["size"]>

/**
 * `unstyled` is for buttons that used to be a plain `<button>` with their own
 * classes: in Classic they still render exactly that (no shadcn styling, the
 * browser's own default `type`), and in Arc they become Arc's Button like the rest.
 */
export type ButtonProps = ClassicProps & { unstyled?: boolean }

const ARC_VARIANT: Record<Variant, ArcButtonProps["variant"]> = {
  default: "primary",
  secondary: "secondary",
  outline: "secondary",
  ghost: "ghost",
  destructive: "danger",
  link: "ghost",
}

function arcSize(size: Size): { size: ArcButtonProps["size"]; icon: boolean } {
  if (size === "lg") return { size: "md", icon: false }
  return { size: "sm", icon: size.startsWith("icon") }
}

function Button({ unstyled, ...props }: ButtonProps) {
  const arc = useIsArc()
  // base-ui's `render` swaps the element, which Arc's Button cannot do: keep the classic one.
  if (arc && !props.render) {
    const { variant, size, className, type } = props
    const rest = omit(props, ["variant", "size", "className", "type", "render", "nativeButton", "focusableWhenDisabled"])
    const mapped = arcSize(size ?? "default")
    return (
      <ArcButton
        {...(rest as ArcButtonProps)}
        // base-ui defaults a button to type="button"; an `unstyled` one keeps the native default it had as a raw <button>.
        type={type ?? (unstyled ? undefined : "button")}
        variant={ARC_VARIANT[variant ?? "default"]}
        size={mapped.size}
        data-slot="button"
        className={cx(mapped.icon && bridge.icon, classOf(className))}
      />
    )
  }
  if (unstyled) {
    const rest = omit(props, ["variant", "size", "className", "render", "nativeButton", "focusableWhenDisabled"])
    return <button {...(rest as React.ComponentProps<"button">)} className={classOf(props.className)} />
  }
  return <ClassicButton {...props} />
}

export { Button, buttonVariants }
