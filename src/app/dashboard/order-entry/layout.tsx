import { redirect } from "next/navigation";
import { hasOrderEntryAccess, isCurrentUserSuperAdmin } from "@/actions/settings";
import OrderEntryShell from "@/components/order-entry/OrderEntryShell";
import PullToRefresh from "@/components/order-entry/PullToRefresh";

// Server-side gate: only users the admin has granted Order Entry access reach
// this route. Hiding the sidebar link is UX; this is the real guard.
export default async function OrderEntryLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasOrderEntryAccess())) {
    redirect("/dashboard");
  }
  const superAdmin = await isCurrentUserSuperAdmin();
  return (
    <OrderEntryShell isSuperAdmin={superAdmin}>
      <PullToRefresh>{children}</PullToRefresh>
    </OrderEntryShell>
  );
}
