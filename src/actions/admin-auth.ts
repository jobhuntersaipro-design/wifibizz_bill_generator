"use server";

import { createAdminSession, clearAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export interface AdminLoginResult {
  error?: string;
}

export async function adminLogin(
  username: string,
  password: string
): Promise<AdminLoginResult | undefined> {
  const validUsername = process.env.BIZZFLOW_ADMIN_USERNAME;
  const validPassword = process.env.BIZZFLOW_ADMIN_PWD;

  if (!validUsername || !validPassword) {
    return { error: "Admin credentials not configured" };
  }

  if (username !== validUsername || password !== validPassword) {
    return { error: "Invalid admin credentials" };
  }

  await createAdminSession();
  redirect("/admin");
}

export async function adminLogout() {
  await clearAdminSession();
  redirect("/admin/login");
}
