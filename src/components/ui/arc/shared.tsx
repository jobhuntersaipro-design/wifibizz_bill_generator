"use client";

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import bridge from "./bridge.module.css";

/**
 * Helpers for the Arc adapters. The app's primitives are base-ui (shadcn
 * "base-nova"); Arc is built on Radix. The two differ in a few small ways these
 * smooth over, so no call site has to know which design is rendering.
 */

/** base-ui allows `className` to be a function of state; Arc takes a string. */
export function classOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Joins class names, dropping empties. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/**
 * base-ui triggers take `render={<el/>}` where Radix takes `asChild` + the element as
 * the child. Returns the element Radix should clone, with any children the trigger
 * itself was given placed inside it (base-ui's behaviour), or null when there is no
 * render element.
 */
export function renderTarget(render: unknown, children: ReactNode): ReactElement | null {
  if (!isValidElement(render)) return null;
  const own = (render.props as { children?: ReactNode }).children;
  return children === undefined || children === null ? render : cloneElement(render, undefined, children ?? own);
}

/** Splits a compound component's children into the first element of each given type and the rest. */
export function partition(children: ReactNode, ...types: unknown[]): { found: Array<ReactElement | null>; rest: ReactNode[] } {
  const found: Array<ReactElement | null> = types.map(() => null);
  const rest: ReactNode[] = [];
  Children.forEach(children, (child) => {
    const index = isValidElement(child) ? types.indexOf(child.type) : -1;
    if (index >= 0 && !found[index]) found[index] = child as ReactElement;
    else rest.push(child);
  });
  return { found, rest };
}

/** Maps a caller's `sm:max-w-*` width class onto one of the bridge's dialog sizes. */
export function dialogSize(className: string | undefined): "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | undefined {
  const match = className?.match(/max-w-(sm|md|lg|xl|2xl|3xl|4xl)\b/);
  return match ? (match[1] as "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl") : undefined;
}

/** A copy of `props` without the named keys — for base-ui-only props Arc's elements must not receive. */
export function omit<T extends object, K extends keyof T>(props: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...props };
  for (const key of keys) delete copy[key];
  return copy;
}

/** The bridge class for each dialog width dialogSize() reads. */
export const DIALOG_SIZE_CLASS = { sm: bridge.sm, md: bridge.md, lg: bridge.lg, xl: bridge.xl, "2xl": bridge.x2l, "3xl": bridge.x3l, "4xl": bridge.x4l };
