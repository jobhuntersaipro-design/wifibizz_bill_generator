"use client"

import * as React from "react"
import * as ArcTabs from "@/components/arc/components/tabs/tabs"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/tabs"
import { classOf } from "./arc/shared"

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

/** In Arc: Arc's Tabs — the sliding indicator, overflow arrows and directional panel morph. */
function Tabs(props: ClassicProps<typeof Classic.Tabs>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Tabs {...props} />
  const { value, defaultValue, onValueChange, className, children } = props
  return (
    <ArcTabs.Tabs
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      onValueChange={onValueChange ? (next) => onValueChange(next, undefined as never) : undefined}
      className={classOf(className)}
    >
      {children as React.ReactNode}
    </ArcTabs.Tabs>
  )
}

function TabsList(props: ClassicProps<typeof Classic.TabsList>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TabsList {...props} />
  return <ArcTabs.TabsList className={classOf(props.className)}>{props.children as React.ReactNode}</ArcTabs.TabsList>
}

function TabsTrigger(props: ClassicProps<typeof Classic.TabsTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TabsTrigger {...props} />
  return (
    <ArcTabs.TabsTrigger value={String(props.value)} disabled={props.disabled} className={classOf(props.className)}>
      {props.children as React.ReactNode}
    </ArcTabs.TabsTrigger>
  )
}

function TabsContent(props: ClassicProps<typeof Classic.TabsContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.TabsContent {...props} />
  return (
    <ArcTabs.TabsContent value={String(props.value)} className={classOf(props.className)}>
      {props.children as React.ReactNode}
    </ArcTabs.TabsContent>
  )
}

const { tabsListVariants } = Classic

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
