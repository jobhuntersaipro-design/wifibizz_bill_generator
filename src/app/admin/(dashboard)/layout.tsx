import { verifyAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import PullToRefresh from "@/components/ui/pull-to-refresh";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return (
    <AdminShell>
      <PullToRefresh>{children}</PullToRefresh>
    </AdminShell>
  );
}
