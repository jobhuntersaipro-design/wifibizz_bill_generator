"use client"

import { useEffect } from "react"
import type { ToasterProps } from "sonner"
import { ToastStack, ToastStackProvider, useToastStack } from "@/components/arc/components/toast-stack/toast-stack"
import { useIsArc } from "@/components/design/use-design"
import { registerArcToasts } from "@/lib/toast"
import { Toaster as ClassicToaster } from "./classic/sonner"

/** Hands Arc's toast API to `@/lib/toast` for as long as the stack is mounted. */
function RegisterArcToasts() {
  const api = useToastStack()
  const { toast, update, dismiss } = api
  useEffect(() => registerArcToasts({ toast, update, dismiss }), [toast, update, dismiss])
  return null
}

/** Classic: sonner. Arc: Arc's ToastStack, fed by the same `toast()` calls. Both stay mounted so a design flip never drops a toast that is on screen. */
function Toaster(props: ToasterProps) {
  const arc = useIsArc()
  return (
    <>
      <ClassicToaster {...props} />
      {arc && (
        <ToastStackProvider>
          <RegisterArcToasts />
          <ToastStack position="bottom-right" />
        </ToastStackProvider>
      )}
    </>
  )
}

export { Toaster }
