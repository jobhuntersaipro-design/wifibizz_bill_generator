"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

export interface LoginResult {
  error?: string;
  rateLimited?: boolean;
}

export async function login(
  email: string,
  password: string,
  callbackUrl: string
): Promise<LoginResult | undefined> {
  const headersList = await headers();
  const forwarded = headersList.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";

  const identifier = `${ip}:${email}`;
  const { success, reset } = await checkRateLimit(identifier);
  if (!success) {
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
    return {
      error: `Too many attempts. Please try again in ${minutes} minutes.`,
      rateLimited: true,
    };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    // NEXT_REDIRECT is thrown as an error by signIn on success — re-throw it
    throw error;
  }
}
