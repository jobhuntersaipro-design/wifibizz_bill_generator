import type { ReactNode } from "react";
import { toast as sonner, type ExternalToast } from "sonner";
import type { ToastStackApi, ToastType } from "@/components/arc/components/toast-stack/toast-stack";
import { readDesign } from "@/lib/design";

/**
 * `toast` with sonner's surface, routed by design: Classic shows sonner's toasts,
 * Arc shows Arc's ToastStack. Call sites import this instead of "sonner", so the
 * design decides how a message looks and no caller has to know.
 *
 * Arc's stack registers itself while it is mounted (see components/ui/sonner.tsx);
 * until then — and in Classic — everything goes to sonner.
 */

let arc: ToastStackApi | null = null;

export function registerArcToasts(api: ToastStackApi): () => void {
  arc = api;
  return () => {
    if (arc === api) arc = null;
  };
}

type Message = string | ReactNode;
type Options = ExternalToast;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function show(type: ToastType, message: Message, options: Options | undefined, viaSonner: () => string | number): string | number {
  if (!arc || readDesign() !== "arc") return viaSonner();
  const action = options?.action;
  const actionLabel = action && typeof action === "object" && "label" in action ? text(action.label) : undefined;
  return arc.toast({
    id: options?.id === undefined ? undefined : String(options.id),
    type,
    title: text(message) ?? "",
    description: text(options?.description),
    duration: options?.duration,
    action:
      action && typeof action === "object" && "onClick" in action && actionLabel
        ? { label: actionLabel, onClick: () => action.onClick(undefined as never) }
        : undefined,
  });
}

function base(message: Message, options?: Options) {
  return show("info", message, options, () => sonner(message, options));
}

export const toast = Object.assign(base, {
  success: (message: Message, options?: Options) => show("success", message, options, () => sonner.success(message, options)),
  error: (message: Message, options?: Options) => show("error", message, options, () => sonner.error(message, options)),
  warning: (message: Message, options?: Options) => show("warning", message, options, () => sonner.warning(message, options)),
  info: (message: Message, options?: Options) => show("info", message, options, () => sonner.info(message, options)),
  message: (message: Message, options?: Options) => show("info", message, options, () => sonner.message(message, options)),
  loading: (message: Message, options?: Options) => show("loading", message, options, () => sonner.loading(message, options)),
  dismiss: (id?: string | number) => {
    if (arc && readDesign() === "arc") arc.dismiss(id === undefined ? undefined : String(id));
    return sonner.dismiss(id);
  },
});
