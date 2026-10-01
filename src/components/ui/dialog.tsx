"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { Button as ArcButton } from "@/components/arc/components/button/button"
import arcDialog from "@/components/arc/components/dialog/dialog.module.css"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/dialog"
import { classOf, cx, DIALOG_SIZE_CLASS, dialogSize, partition, renderTarget } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

/*
 * In Arc these render Arc's dialog: its Radix root, overlay, panel, header with
 * the close button, and body, with Arc's own enter/leave keyframes. Arc's
 * DialogContent takes its title as a prop; this app composes a header out of
 * DialogTitle/DialogDescription instead, so the content lays those parts out in
 * Arc's slots itself.
 */

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

function Dialog(props: ClassicProps<typeof Classic.Dialog>) {
  const arc = useIsArc()
  if (!arc) return <Classic.Dialog {...props} />
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

function DialogTrigger(props: ClassicProps<typeof Classic.DialogTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogTrigger {...props} />
  const target = renderTarget(props.render, props.children as React.ReactNode)
  if (target) return <DialogPrimitive.Trigger asChild>{target}</DialogPrimitive.Trigger>
  return <DialogPrimitive.Trigger className={classOf(props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Trigger>
}

function DialogClose(props: ClassicProps<typeof Classic.DialogClose>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogClose {...props} />
  const children = props.children as React.ReactNode
  const target = renderTarget(props.render, children)
  if (target) return <DialogPrimitive.Close asChild>{target}</DialogPrimitive.Close>
  // A bare DialogClose is a text button ("Cancel", "Close"): Arc's secondary button.
  return (
    <DialogPrimitive.Close asChild>
      <ArcButton type="button" variant="secondary" size="sm" className={classOf(props.className)} disabled={props.disabled}>
        {children}
      </ArcButton>
    </DialogPrimitive.Close>
  )
}

function CloseIcon({ alone }: { alone: boolean }) {
  return (
    <DialogPrimitive.Close className={cx(arcDialog.close, alone && bridge.closeOnly)} aria-label="Close dialog">
      <X width={18} height={18} aria-hidden="true" />
    </DialogPrimitive.Close>
  )
}

function DialogContent(props: ClassicProps<typeof Classic.DialogContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogContent {...props} />
  const { className, children, showCloseButton = true, id } = props
  const caller = classOf(className)
  const size = dialogSize(caller)
  const { found: [header, footer], rest } = partition(children as React.ReactNode, DialogHeader, DialogFooter)
  const body = rest.filter((node) => node !== null && node !== undefined && node !== false)
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cx(arcDialog.overlay, arcDialog.keyframes)} />
      <DialogPrimitive.Content
        id={id}
        aria-describedby={props["aria-describedby"]}
        aria-labelledby={props["aria-labelledby"]}
        className={cx(arcDialog.content, arcDialog.keyframes, bridge.content, size && DIALOG_SIZE_CLASS[size])}
      >
        {header ? (
          <div className={arcDialog.header}>
            <div className={bridge.headerText}>{(header.props as { children?: React.ReactNode }).children}</div>
            {showCloseButton && <CloseIcon alone={false} />}
          </div>
        ) : (
          showCloseButton && <CloseIcon alone />
        )}
        {body.length > 0 && <div className={arcDialog.body}>{body}</div>}
        {footer && <div className={bridge.footer}>{(footer.props as { children?: React.ReactNode }).children}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/** Laid out by DialogContent in Arc; this fallback only renders when a header sits deeper than the content's own children. */
function DialogHeader(props: React.ComponentProps<"div">) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogHeader {...props} />
  return <div className={bridge.headerText}>{props.children}</div>
}

function DialogFooter(props: ClassicProps<typeof Classic.DialogFooter>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogFooter {...props} />
  return <div className={bridge.footer}>{props.children}</div>
}

function textClass(arcClass: string, className: unknown): string {
  const caller = classOf(className) ?? ""
  // A visually hidden title must stay hidden: Arc's type would put `position: relative` back.
  return caller.includes("sr-only") ? caller : cx(arcClass, caller)
}

function DialogTitle(props: ClassicProps<typeof Classic.DialogTitle>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogTitle {...props} />
  return <DialogPrimitive.Title className={textClass(bridge.title, props.className)}>{props.children as React.ReactNode}</DialogPrimitive.Title>
}

function DialogDescription(props: ClassicProps<typeof Classic.DialogDescription>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DialogDescription {...props} />
  return (
    <DialogPrimitive.Description id={props.id} className={textClass(bridge.description, props.className)}>
      {props.children as React.ReactNode}
    </DialogPrimitive.Description>
  )
}

const DialogOverlay = Classic.DialogOverlay
const DialogPortal = Classic.DialogPortal

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
