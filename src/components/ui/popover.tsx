"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import * as ArcPopover from "@/components/arc/components/popover/popover"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/popover"
import { classOf, renderTarget } from "./arc/shared"

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

/** In Arc: Arc's Popover (Radix underneath) with its anchor and panel styling. */
function Popover(props: ClassicProps<typeof Classic.Popover>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Popover {...props} />
  const { open, defaultOpen, onOpenChange, modal, children } = props
  return (
    <PopoverPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      modal={modal === true}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next, undefined as never) : undefined}
    >
      {children as React.ReactNode}
    </PopoverPrimitive.Root>
  )
}

function PopoverTrigger(props: ClassicProps<typeof Classic.PopoverTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.PopoverTrigger {...props} />
  const target = renderTarget(props.render, props.children as React.ReactNode)
  if (target) return <ArcPopover.PopoverTrigger asChild>{target}</ArcPopover.PopoverTrigger>
  return <ArcPopover.PopoverTrigger className={classOf(props.className)}>{props.children as React.ReactNode}</ArcPopover.PopoverTrigger>
}

function PopoverContent(props: ClassicProps<typeof Classic.PopoverContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.PopoverContent {...props} />
  const { align = "start", side = "bottom", sideOffset = 6, className, children } = props
  return (
    <ArcPopover.PopoverContent
      align={align === "center" || align === "end" ? align : "start"}
      side={side === "top" || side === "left" || side === "right" ? side : "bottom"}
      sideOffset={typeof sideOffset === "number" ? sideOffset : 6}
      className={classOf(className)}
    >
      {children as React.ReactNode}
    </ArcPopover.PopoverContent>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
