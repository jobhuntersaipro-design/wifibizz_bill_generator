import { verifyAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) redirect("/admin/login");

  return <AdminShell>{children}</AdminShell>;
}
