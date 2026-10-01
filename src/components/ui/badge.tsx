"use client"

import * as React from "react"
import { Badge as ArcBadge, type BadgeProps as ArcBadgeProps } from "@/components/arc/components/badge/badge"
import { useIsArc } from "@/components/design/use-design"
import { Badge as ClassicBadge, badgeVariants } from "./classic/badge"
import { classOf, omit } from "./arc/shared"

type Props = React.ComponentProps<typeof ClassicBadge>
type Variant = NonNullable<Props["variant"]>

const TONE: Record<Variant, ArcBadgeProps["tone"]> = {
  default: "info",
  secondary: "neutral",
  destructive: "danger",
  outline: "neutral",
  ghost: "neutral",
  link: "info",
}

function Badge(props: Props) {
  const arc = useIsArc()
  if (!arc || props.render) return <ClassicBadge {...props} />
  const { variant, className, children } = props
  const rest = omit(props, ["variant", "className", "children", "render"])
  return (
    <ArcBadge {...(rest as ArcBadgeProps)} tone={TONE[variant ?? "default"]} size="sm" className={classOf(className)}>
      {children}
    </ArcBadge>
  )
}

export { Badge, badgeVariants }
