"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import arcDrawer from "@/components/arc/components/drawer/drawer.module.css"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/sheet"
import { classOf, cx, renderTarget } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

/*
 * In Arc a sheet is Arc's Drawer panel: the same Radix dialog underneath, Arc's
 * overlay, edge panel, close button and slide keyframes. Callers here lay out
 * their own header inside the sheet, so the panel's body is theirs.
 */

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

function Sheet(props: ClassicProps<typeof Classic.Sheet>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Sheet {...props} />
  const { open, defaultOpen, onOpenChange, modal, children } = props
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      modal={modal !== false}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next, undefined as never) : undefined}
    >
      {children as React.ReactNode}
    </DialogPrimitive.Root>
  )
}

function SheetTrigger(props: ClassicProps<typeof Classic.SheetTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.SheetTrigger {...props} />
  const target = renderTarget(props.render, props.children as React.ReactNode)
  if (target) return <DialogPrimitive.Trigger asChild>{target}</DialogPrimitive.Trigger>
  return <DialogPrimitive.Trigger className={classOf(props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Trigger>
}

function SheetClose(props: ClassicProps<typeof Classic.SheetClose>) {
  const arc = useIsArc()
  if (!arc) return <Classic.SheetClose {...props} />
  const target = renderTarget(props.render, props.children as React.ReactNode)
  if (target) return <DialogPrimitive.Close asChild>{target}</DialogPrimitive.Close>
  return <DialogPrimitive.Close className={classOf(props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Close>
}

function SheetContent(props: ClassicProps<typeof Classic.SheetContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.SheetContent {...props} />
  const { side = "right", showCloseButton = true, children } = props
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cx(arcDrawer.overlay, arcDrawer.keyframes)} />
      <DialogPrimitive.Content
        data-side={side}
        aria-describedby={props["aria-describedby"]}
        className={cx(arcDrawer.content, arcDrawer.keyframes)}
      >
        {showCloseButton && (
          <DialogPrimitive.Close className={cx(arcDrawer.close, bridge.closeOnly)} aria-label="Close panel">
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
        <div className={bridge.sheetBody}>{children as React.ReactNode}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function textClass(arcClass: string, className: unknown): string {
  const caller = classOf(className) ?? ""
  return caller.includes("sr-only") ? caller : cx(arcClass, caller)
}

function SheetTitle(props: ClassicProps<typeof Classic.SheetTitle>) {
  const arc = useIsArc()
  if (!arc) return <Classic.SheetTitle {...props} />
  return <DialogPrimitive.Title className={textClass(bridge.title, props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Title>
}

function SheetDescription(props: ClassicProps<typeof Classic.SheetDescription>) {
  const arc = useIsArc()
  if (!arc) return <Classic.SheetDescription {...props} />
  return <DialogPrimitive.Description className={textClass(bridge.description, props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Description>
}

const SheetHeader = Classic.SheetHeader
const SheetFooter = Classic.SheetFooter

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
