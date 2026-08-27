import { redirect } from "next/navigation";
import { hasOrderEntryAccess } from "@/actions/settings";
import PullToRefresh from "@/components/order-entry/PullToRefresh";

/**
 * Chrome-free shell for standalone Order Entry pages (the order detail tab).
 *
 * Deliberately NOT nested under /dashboard: that layout brings the sidebar,
 * and the order-entry layout under it brings the tab strip and the dealer
 * connection card — none of which belong on a focused, opened-in-a-new-tab
 * detail view. Same server-side access gate as the dashboard route, though:
 * moving out of the folder must not move out of the guard.
 */
export default async function StandaloneOrderEntryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await hasOrderEntryAccess())) {
    redirect("/dashboard");
  }
  return (
    <div className="min-h-screen bg-[#F6F9FC]">
      <PullToRefresh>{children}</PullToRefresh>
    </div>
  );
}
