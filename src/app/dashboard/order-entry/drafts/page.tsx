"use client";

import { useRouter } from "next/navigation";
import { OrdersList } from "@/components/order-entry/OrdersList";

export default function DraftsPage() {
  const router = useRouter();
  return (
    <OrdersList
      onEdit={(id) =>
        router.push(`/dashboard/order-entry/new-order?draft=${encodeURIComponent(id)}`)
      }
    />
  );
}
