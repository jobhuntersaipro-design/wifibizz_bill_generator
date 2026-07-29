import { redirect } from "next/navigation";
import { hasOrderEntryAccess } from "@/actions/settings";
import OrderEntryShell from "@/components/order-entry/OrderEntryShell";

// Server-side gate: only users the admin has granted Order Entry access reach
// this route. Hiding the sidebar link is UX; this is the real guard.
export default async function OrderEntryLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasOrderEntryAccess())) {
    redirect("/dashboard");
  }
  return <OrderEntryShell>{children}</OrderEntryShell>;
}
