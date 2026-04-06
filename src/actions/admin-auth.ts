"use server";

import { createAdminSession, clearAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { timingSafeEqual } from "crypto";

export interface AdminLoginResult {
  error?: string;
  rateLimited?: boolean;
}

export async function adminLogin(
  username: string,
  password: string
): Promise<AdminLoginResult | undefined> {
  // Rate limiting
  const headersList = await headers();
  const forwarded = headersList.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";
  const identifier = `admin:${ip}:${username}`;
  const { success: allowed, reset } = await checkRateLimit(identifier);
  if (!allowed) {
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
    return {
      error: `Too many attempts. Please try again in ${minutes} minutes.`,
      rateLimited: true,
    };
  }

  const validUsername = process.env.BIZZFLOW_ADMIN_USERNAME;
  const validPassword = process.env.BIZZFLOW_ADMIN_PWD;

  if (!validUsername || !validPassword) {
    return { error: "Admin credentials not configured" };
  }

  // Timing-safe comparison to prevent timing attacks
  const usernameMatch =
    username.length === validUsername.length &&
    timingSafeEqual(Buffer.from(username, "utf8"), Buffer.from(validUsername, "utf8"));
  const passwordMatch =
    password.length === validPassword.length &&
    timingSafeEqual(Buffer.from(password, "utf8"), Buffer.from(validPassword, "utf8"));

  if (!usernameMatch || !passwordMatch) {
    return { error: "Invalid admin credentials" };
  }

  await createAdminSession();
  redirect("/admin");
}

export async function adminLogout() {
  await clearAdminSession();
  redirect("/admin/login");
}
