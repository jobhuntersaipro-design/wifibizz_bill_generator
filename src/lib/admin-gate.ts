import { verifyAdminSession } from "@/lib/admin-auth";

/**
 * The gate every admin Server Action starts with. Admin is the shared JWT
 * (`verifyAdminSession`), NOT a NextAuth session — `/admin` is a separate
 * identity from a signed-in agent. Not a "use server" file, so exporting it
 * does not make it a POST-able action.
 */
export async function requireAdmin(): Promise<{ success: false; error: string } | null> {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) return { success: false, error: "Unauthorized" };
  return null;
}
