"use client"

import * as React from "react"
import { useIsArc } from "@/components/design/use-design"
import { Skeleton as ClassicSkeleton } from "./classic/skeleton"
import { cx } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

/** In Arc a box placeholder pulses on Arc's skeleton colour and rhythm. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  const arc = useIsArc()
  if (!arc) return <ClassicSkeleton className={className} {...props} />
  return <div data-slot="skeleton" aria-hidden="true" {...props} className={cx(bridge.skeleton, className)} />
}

export { Skeleton }
