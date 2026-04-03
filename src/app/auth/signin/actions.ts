"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";

export async function authenticate(email: string, password: string) {
  // Validate credentials manually first
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) {
    return { error: "Invalid username or password" };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return { error: "Invalid username or password" };
  }

  // Credentials are valid — now sign in (this will redirect)
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return { error: "Something went wrong" };
  }
}
