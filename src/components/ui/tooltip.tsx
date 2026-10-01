"use client"

import * as React from "react"
import { Tooltip as ArcTooltip } from "@/components/arc/components/tooltip/tooltip"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/tooltip"
import { classOf, partition, renderTarget } from "./arc/shared"

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

/*
 * Arc's Tooltip is one component — `<Tooltip content={…}>{trigger}</Tooltip>` —
 * with its own provider, delay and shared skip window. The compound shadcn
 * parts are collected here and handed to it.
 */

function TooltipProvider(props: ClassicProps<typeof Classic.TooltipProvider>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TooltipProvider {...props} />
  return <>{props.children as React.ReactNode}</>
}

function Tooltip(props: ClassicProps<typeof Classic.Tooltip>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Tooltip {...props} />
  const { found: [trigger, content] } = partition(props.children as React.ReactNode, TooltipTrigger, TooltipContent)
  if (!trigger) return <>{props.children as React.ReactNode}</>
  const triggerProps = trigger.props as ClassicProps<typeof Classic.TooltipTrigger>
  const target =
    renderTarget(triggerProps.render, triggerProps.children as React.ReactNode) ?? (
      <button type="button" className={classOf(triggerProps.className)}>{triggerProps.children as React.ReactNode}</button>
    )
  const contentProps = content?.props as ClassicProps<typeof Classic.TooltipContent> | undefined
  if (props.disabled || !contentProps) return target
  return (
    <ArcTooltip content={contentProps.children as React.ReactNode} side={contentProps.side === "bottom" ? "bottom" : "top"}>
      {target}
    </ArcTooltip>
  )
}

/** In Arc these only carry props for Tooltip to collect. */
function TooltipTrigger(props: ClassicProps<typeof Classic.TooltipTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TooltipTrigger {...props} />
  return renderTarget(props.render, props.children as React.ReactNode) ?? <>{props.children as React.ReactNode}</>
}

function TooltipContent(props: ClassicProps<typeof Classic.TooltipContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TooltipContent {...props} />
  return null
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
