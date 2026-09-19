import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasOrderEntryAccess, isCurrentUserSuperAdmin } from "@/actions/settings";
import OrderEntryShell from "@/components/order-entry/OrderEntryShell";

function OrderEntryShellFallback() {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-sm text-[#697386]">Loading…</p>
    </div>
  );
}

// Server-side gate: only users the admin has granted Order Entry access reach
// this route. Hiding the sidebar link is UX; this is the real guard.
export default async function OrderEntryLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasOrderEntryAccess())) {
    redirect("/dashboard");
  }
  const superAdmin = await isCurrentUserSuperAdmin();
  // No PullToRefresh here: the dashboard shell above already mounts one, and a
  // second would bind a second set of global listeners to the same gesture.
  return (
    <Suspense fallback={<OrderEntryShellFallback />}>
      <OrderEntryShell isSuperAdmin={superAdmin}>{children}</OrderEntryShell>
    </Suspense>
  );
}
