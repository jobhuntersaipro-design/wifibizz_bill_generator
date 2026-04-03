import { Suspense } from "react";
import { AdminLoginForm } from "./admin-login-form";
import { verifyAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function AdminLoginPage() {
  const isAdmin = await verifyAdminSession();
  if (isAdmin) redirect("/admin");

  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
