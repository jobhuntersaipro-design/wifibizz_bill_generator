import { createHash, randomBytes } from "crypto";

/**
 * Password-reset token rules, pure so they can be tested without a database.
 *
 * The mailed token never touches storage: the table keeps its SHA-256, so a
 * database leak cannot hand out live reset links. SHA-256 rather than bcrypt
 * because the input is 32 random bytes — brute force is already hopeless, and
 * a fast hash lets the lookup be an indexed equality instead of a scan.
 */

/** 30 minutes — long enough to read a mail on a phone, short enough to leak safely. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function newResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Usable = never used and not expired. Both checked again at claim time. */
export function isTokenUsable(
  row: { usedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return row.usedAt === null && row.expiresAt.getTime() > now.getTime();
}

/** One password rule for change AND reset, so the two flows cannot disagree. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  return null;
}
