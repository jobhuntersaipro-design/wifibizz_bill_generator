"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderForm } from "@/components/order-entry/OrderForm";
import { isFormSection } from "@/lib/order-sections";

function NewOrderInner() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get("draft");
  const cloneId = params.get("clone");
  // From a failure's "Fix the draft": which card to open on. Validated, so a
  // stray value scrolls nowhere rather than throwing.
  const focus = params.get("focus");

  return (
    <OrderForm
      key={draftId ?? cloneId ?? "new"}
      editingId={draftId}
      cloneId={cloneId}
      focusSection={isFormSection(focus) ? focus : null}
      onSaved={() => router.push("/dashboard/order-entry/drafts")}
      onBack={() => router.push("/dashboard/order-entry/drafts")}
    />
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={null}>
      <NewOrderInner />
    </Suspense>
  );
}
