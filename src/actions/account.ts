"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/notifications/resend";
import { appBaseUrl, accountEmailShell } from "@/lib/notifications/templates";
import {
  hashResetToken,
  isTokenUsable,
  newResetToken,
  passwordProblem,
} from "@/lib/password-reset";

/**
 * Self-service account actions.
 *
 * All three are directly POST-able Server Actions, so every rule is enforced
 * HERE, not in the forms: the current-password check, the identical
 * forgot-response for known and unknown addresses, the single-use token claim.
 */

/** Change the login password. Requires the CURRENT password — an open, stolen
 * session must not be enough to take the account over quietly. */
export async function changePassword(current: string, next: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Unauthorized" };

  // Wrong-current-password attempts ARE password guesses.
  const rl = await checkRateLimit(`change-password:${session.user.id}`);
  if (!rl.success) {
    return { success: false as const, error: "Too many attempts. Try again in a few minutes." };
  }

  const problem = passwordProblem(next);
  if (problem) return { success: false as const, error: problem };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true },
  });
  if (!user?.password) return { success: false as const, error: "Account has no password set." };

  const ok = await bcrypt.compare(current, user.password);
  if (!ok) return { success: false as const, error: "Current password is incorrect." };

  // Both stores together: admin visibility of passwordRaw was kept by an
  // explicit decision, and a change that silently broke it would make the
  // admin Users page lie.
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(next, 12), passwordRaw: next },
  });
  // Actor is the user THEMSELVES — no admin involved, and the trail says so.
  await recordAudit({ actor: user.id, action: "password_changed", targetUser: user.id });
  return { success: true as const };
}

/**
 * Ask for a reset link.
 *
 * ALWAYS answers the same message, found or not — anything else is an
 * account-enumeration oracle. The mail goes to the LOGIN e-mail only: the
 * notification address is agent-editable, and a resettable address you can
 * point anywhere is an account-takeover lever.
 */
const FORGOT_REPLY = {
  success: true as const,
  message: "If that address has an account, a reset link is on its way.",
};

export async function requestPasswordReset(emailRaw: string) {
  const email = (emailRaw || "").trim().toLowerCase();
  if (!email) return FORGOT_REPLY;

  // Per-address; the page is public, so this is the only brake it has.
  const rl = await checkRateLimit(`password-reset:${email}`);
  if (!rl.success) return FORGOT_REPLY;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user?.email) return FORGOT_REPLY;

  const base = appBaseUrl();
  if (!base) {
    console.error("[requestPasswordReset] no app base URL — cannot build a link");
    return FORGOT_REPLY;
  }

  const { token, tokenHash, expiresAt } = newResetToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const link = `${base}/auth/reset?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your BizzFlow password",
    html: accountEmailShell(
      "Reset your password",
      `Somebody — hopefully you — asked to reset the password for this account.
       The link below works once and expires in 30 minutes.`,
      { label: "Choose a new password", url: link },
      "If this wasn't you, ignore this mail; nothing has changed.",
    ),
  });
  return FORGOT_REPLY;
}

/** Finish a reset. The token is claimed CONDITIONALLY, so a double-click — or
 * two tabs — cannot burn it twice or race two different passwords in. */
export async function resetPassword(token: string, next: string) {
  const problem = passwordProblem(next);
  if (problem) return { success: false as const, error: problem };

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token || "") },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  });
  if (!row || !isTokenUsable(row)) {
    return { success: false as const, error: "This reset link is invalid or has expired. Request a new one." };
  }

  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { success: false as const, error: "This reset link has already been used." };
  }

  await prisma.user.update({
    where: { id: row.userId },
    data: { password: await bcrypt.hash(next, 12), passwordRaw: next },
  });
  await recordAudit({ actor: row.userId, action: "password_reset", targetUser: row.userId,
    detail: "Via e-mailed reset link." });
  return { success: true as const };
}
