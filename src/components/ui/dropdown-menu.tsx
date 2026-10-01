"use client"

import * as React from "react"
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu"
import arcMenu from "@/components/arc/components/dropdown-menu/dropdown-menu.module.css"
import { useIsArc } from "@/components/design/use-design"
import * as Classic from "./classic/dropdown-menu"
import { classOf, cx, renderTarget } from "./arc/shared"
import bridge from "./arc/bridge.module.css"

type ClassicProps<T extends (props: never) => unknown> = Parameters<T>[0]

/*
 * In Arc: Radix's dropdown menu (what Arc's DropdownMenu is built on) dressed in
 * Arc's menu stylesheet — its panel, enter/leave, items, destructive tone and
 * separators. Arc's own DropdownMenu takes an `items` array; the app composes
 * items as children, so the parts are mapped one to one instead.
 */

function DropdownMenu(props: ClassicProps<typeof Classic.DropdownMenu>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenu {...props} />
  const { open, defaultOpen, onOpenChange, modal, children } = props
  return (
    <MenuPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      modal={modal !== false}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next, undefined as never) : undefined}
    >
      {children as React.ReactNode}
    </MenuPrimitive.Root>
  )
}

function DropdownMenuTrigger(props: ClassicProps<typeof Classic.DropdownMenuTrigger>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuTrigger {...props} />
  const target = renderTarget(props.render, props.children as React.ReactNode)
  if (target) return <MenuPrimitive.Trigger asChild>{target}</MenuPrimitive.Trigger>
  return (
    <MenuPrimitive.Trigger className={classOf(props.className)} aria-label={props["aria-label"]} disabled={props.disabled}>
      {props.children as React.ReactNode}
    </MenuPrimitive.Trigger>
  )
}

function DropdownMenuContent(props: ClassicProps<typeof Classic.DropdownMenuContent>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuContent {...props} />
  const { align = "start", side = "bottom", sideOffset = 6, alignOffset = 0, className, children } = props
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align === "center" || align === "end" ? align : "start"}
        side={side === "top" || side === "left" || side === "right" ? side : "bottom"}
        sideOffset={typeof sideOffset === "number" ? sideOffset : 6}
        alignOffset={typeof alignOffset === "number" ? alignOffset : 0}
        collisionPadding={12}
        loop
        className={cx(arcMenu.menu, classOf(className))}
      >
        {children as React.ReactNode}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem(props: ClassicProps<typeof Classic.DropdownMenuItem>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuItem {...props} />
  const { variant, disabled, onClick, className, children } = props
  const danger = variant === "destructive"
  return (
    <MenuPrimitive.Item
      disabled={disabled}
      data-tone={danger ? "danger" : undefined}
      // base-ui items fire onClick; Radix fires onSelect for pointer and keyboard alike.
      onSelect={onClick ? (event) => onClick(event as unknown as Parameters<NonNullable<typeof onClick>>[0]) : undefined}
      className={cx(arcMenu.item, bridge.menuItem, danger && arcMenu.destructive, classOf(className))}
    >
      {children as React.ReactNode}
    </MenuPrimitive.Item>
  )
}

function DropdownMenuSeparator(props: ClassicProps<typeof Classic.DropdownMenuSeparator>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuSeparator {...props} />
  return <MenuPrimitive.Separator className={bridge.menuSeparator} />
}

function DropdownMenuLabel(props: ClassicProps<typeof Classic.DropdownMenuLabel>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuLabel {...props} />
  return <MenuPrimitive.Label className={cx(bridge.menuLabel, classOf(props.className))}>{props.children as React.ReactNode}</MenuPrimitive.Label>
}

function DropdownMenuGroup(props: ClassicProps<typeof Classic.DropdownMenuGroup>) {
  const arc = useIsArc()
  if (!arc) return <Classic.DropdownMenuGroup {...props} />
  return <MenuPrimitive.Group>{props.children as React.ReactNode}</MenuPrimitive.Group>
}

// Not used by the app; they stay classic (base-ui) and must not be placed inside an Arc menu.
const {
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} = Classic

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
