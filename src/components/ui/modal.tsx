"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import arcDialog from "@/components/arc/components/dialog/dialog.module.css"
import { useIsArc } from "@/components/design/use-design"
import bridge from "./arc/bridge.module.css"
import { cx, DIALOG_SIZE_CLASS, dialogSize } from "./arc/shared"

/** Panel classes that carry the content's own spacing and layout, kept on Arc's shell. */
const KEEP = /^([a-z0-9]+:)*(p[xytblr]?-|gap-|space-y-|flex$|flex-col$)/

interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  /** Accessible name of the dialog in Arc (the visible heading stays as written). */
  label: string
  /** Called on Escape in Arc. Without it Escape does nothing, as before. */
  onClose?: () => void
  /** The backdrop's classes, used as-is in Classic. */
  overlayClassName: string
  /** The panel's classes, used as-is in Classic; in Arc only spacing, layout and max-w-* are read. */
  className: string
  /** Extra props for the Classic panel (an inline transition, a stopPropagation). Arc draws its own panel. */
  panelProps?: React.HTMLAttributes<HTMLDivElement>
  children: React.ReactNode
}

/**
 * The app's hand-built modals (a fixed backdrop div around a panel div). Classic
 * renders exactly those two divs, so it is unchanged. Arc renders Arc's dialog:
 * its blurred overlay, its floating panel and its open/close keyframes, on a
 * Radix dialog so focus is trapped. A press outside never closes it, matching
 * the original, which only closed from its own buttons.
 */
/** Any other prop (role, aria-*, onKeyDown, style) lands on the Classic backdrop, where the original had it. */
export function Modal({ label, onClose, overlayClassName, className, panelProps, children, ...overlayProps }: ModalProps) {
  const arc = useIsArc()
  if (!arc) {
    return (
      <div {...overlayProps} className={overlayClassName}>
        <div {...panelProps} className={className}>{children}</div>
      </div>
    )
  }
  const kept = className.split(/\s+/).filter((name) => KEEP.test(name)).join(" ")
  const size = dialogSize(className)
  return (
    <DialogPrimitive.Root open onOpenChange={(next) => { if (!next) onClose?.() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cx(arcDialog.overlay, arcDialog.keyframes)} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cx(arcDialog.content, arcDialog.keyframes, bridge.content, size && DIALOG_SIZE_CLASS[size], kept)}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (!onClose) event.preventDefault() }}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
