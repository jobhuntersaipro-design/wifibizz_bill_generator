"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrdersList } from "@/components/order-entry/OrdersList";
import { OrderForm } from "@/components/order-entry/OrderForm";

function DraftsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get("draft");

  // Editing a draft stays on the Drafts tab (same /drafts route) instead of
  // jumping to New Order — the form renders in-place and returns to the list.
  if (draftId) {
    return (
      <OrderForm
        key={draftId}
        editingId={draftId}
        onSaved={() => router.push("/dashboard/order-entry/drafts")}
        onBack={() => router.push("/dashboard/order-entry/drafts")}
      />
    );
  }

  return (
    <OrdersList
      onEdit={(id) =>
        router.push(`/dashboard/order-entry/drafts?draft=${encodeURIComponent(id)}`)
      }
    />
  );
}

export default function DraftsPage() {
  return (
    <Suspense fallback={null}>
      <DraftsInner />
    </Suspense>
  );
}
