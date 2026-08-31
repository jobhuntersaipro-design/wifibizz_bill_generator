/**
 * The self-service account rules — each one a security property, not a
 * convenience, which is why they are pinned at the action layer where a direct
 * POST would meet them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashResetToken, isTokenUsable, newResetToken, passwordProblem, RESET_TOKEN_TTL_MS } from "@/lib/password-reset";

const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userUpdate = vi.fn();
const tokenCreate = vi.fn();
const tokenFindUnique = vi.fn();
const tokenUpdateMany = vi.fn();
const auth = vi.fn();
const rateLimit = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    passwordResetToken: {
      create: (...a: unknown[]) => tokenCreate(...a),
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      updateMany: (...a: unknown[]) => tokenUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock("@/lib/notifications/resend", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

process.env.BIZZFLOW_APP_URL = "https://bizzflow.top";
const bcrypt = await import("bcryptjs");
const { changePassword, requestPasswordReset, resetPassword } = await import("@/actions/account");

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1" } });
  rateLimit.mockResolvedValue({ success: true });
  userUpdate.mockResolvedValue({});
  tokenCreate.mockResolvedValue({});
  sendEmail.mockResolvedValue({ sent: true });
});

describe("changePassword", () => {
  it("refuses without the CURRENT password being right", async () => {
    // An open, stolen session must not be enough to take the account quietly.
    userFindUnique.mockResolvedValue({ id: "u1", password: await bcrypt.hash("right", 4) });
    const res = await changePassword("wrong", "newpassword1");
    expect(res.success).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("updates BOTH stores together", async () => {
    // passwordRaw's admin visibility was kept deliberately; breaking it silently
    // would make the admin Users page lie.
    userFindUnique.mockResolvedValue({ id: "u1", password: await bcrypt.hash("right", 4) });
    const res = await changePassword("right", "newpassword1");
    expect(res.success).toBe(true);
    const data = userUpdate.mock.calls[0][0].data;
    expect(data.passwordRaw).toBe("newpassword1");
    expect(data.password).not.toBe("newpassword1"); // hashed
  });

  it("applies the shared password rule", async () => {
    expect((await changePassword("x", "short")).success).toBe(false);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("is rate limited — wrong guesses ARE password guesses", async () => {
    rateLimit.mockResolvedValue({ success: false });
    const res = await changePassword("right", "newpassword1");
    expect(res.success).toBe(false);
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  it("answers IDENTICALLY for a known and an unknown address", async () => {
    // Anything else is an account-enumeration oracle.
    userFindFirst.mockResolvedValueOnce({ id: "u1", email: "known@x.com" });
    const known = await requestPasswordReset("known@x.com");
    userFindFirst.mockResolvedValueOnce(null);
    const unknown = await requestPasswordReset("nobody@x.com");
    expect(known).toEqual(unknown);
    expect(sendEmail).toHaveBeenCalledTimes(1); // but only one mail went out
  });

  it("stores the HASH, never the token, and mails the login address", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", email: "agent@x.com" });
    await requestPasswordReset("agent@x.com");
    const stored = tokenCreate.mock.calls[0][0].data.tokenHash;
    const mailedLink: string = sendEmail.mock.calls[0][0].html.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(mailedLink).toBeTruthy();
    expect(stored).not.toBe(mailedLink);
    expect(stored).toBe(hashResetToken(mailedLink));
    expect(sendEmail.mock.calls[0][0].to).toBe("agent@x.com");
  });
});

describe("resetPassword", () => {
  const live = () => ({ id: "t1", userId: "u1", usedAt: null, expiresAt: new Date(Date.now() + 60_000) });

  it("claims the token CONDITIONALLY, so a double-click cannot burn it twice", async () => {
    tokenFindUnique.mockResolvedValue(live());
    tokenUpdateMany.mockResolvedValue({ count: 1 });
    const res = await resetPassword("tok", "newpassword1");
    expect(res.success).toBe(true);
    expect(tokenUpdateMany.mock.calls[0][0].where).toMatchObject({ id: "t1", usedAt: null });
  });

  it("refuses when the claim loses the race", async () => {
    tokenFindUnique.mockResolvedValue(live());
    tokenUpdateMany.mockResolvedValue({ count: 0 });
    const res = await resetPassword("tok", "newpassword1");
    expect(res.success).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuses an expired or used token", async () => {
    tokenFindUnique.mockResolvedValue({ ...live(), expiresAt: new Date(Date.now() - 1000) });
    expect((await resetPassword("tok", "newpassword1")).success).toBe(false);
    tokenFindUnique.mockResolvedValue({ ...live(), usedAt: new Date() });
    expect((await resetPassword("tok", "newpassword1")).success).toBe(false);
  });

  it("refuses an unknown token", async () => {
    tokenFindUnique.mockResolvedValue(null);
    expect((await resetPassword("nope", "newpassword1")).success).toBe(false);
  });
});

describe("the pure token rules", () => {
  it("mints distinct tokens whose hash matches", () => {
    const a = newResetToken(), b = newResetToken();
    expect(a.token).not.toBe(b.token);
    expect(hashResetToken(a.token)).toBe(a.tokenHash);
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now() + RESET_TOKEN_TTL_MS - 5000);
  });

  it("judges usability on used AND expiry", () => {
    const now = new Date();
    expect(isTokenUsable({ usedAt: null, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(true);
    expect(isTokenUsable({ usedAt: now, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(false);
    expect(isTokenUsable({ usedAt: null, expiresAt: now }, now)).toBe(false);
  });

  it("shares one password rule between change and reset", () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("longenough")).toBeNull();
  });
});
