"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderForm } from "@/components/order-entry/OrderForm";

function NewOrderInner() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get("draft");

  return (
    <OrderForm
      key={draftId ?? "new"}
      editingId={draftId}
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
