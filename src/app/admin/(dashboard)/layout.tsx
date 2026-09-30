import { verifyAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import PullToRefresh from "@/components/ui/pull-to-refresh";
import { chatConfig } from "@/lib/admin-chat/config";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  const chat = chatConfig();

  return (
    <AdminShell chat={chat.enabled ? { handoffName: chat.handoffName } : null}>
      <PullToRefresh>{children}</PullToRefresh>
    </AdminShell>
  );
}
