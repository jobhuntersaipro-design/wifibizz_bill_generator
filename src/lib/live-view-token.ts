import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * The token an admin's browser presents to the droplet's live-view route.
 * This module imports Node.js crypto and is server-only; browser code should
 * import `liveViewUrl` from @/lib/live-view-url instead.
 *
 * That route cannot check X-Internal-Token (EventSource sends no headers), so
 * this is the whole gate: an HMAC under a key DERIVED from the internal token
 * — no second secret to configure on either side — bound to ONE job id and
 * 30 minutes long. Mirrored byte-for-byte in scraper/live_view.py; the shared
 * vector in both test files is what keeps them in step.
 */
export const LIVE_VIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

function key(secret: string): Buffer {
  return createHash("sha256").update("bizzflow-live-view:" + secret).digest();
}

function sign(jobId: string, expSeconds: number, secret: string): string {
  return createHmac("sha256", key(secret)).update(`${jobId}.${expSeconds}`).digest("hex");
}

export function mintLiveViewToken(
  jobId: string,
  secret: string,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  const expSeconds = Math.floor((now + LIVE_VIEW_TOKEN_TTL_MS) / 1000);
  return {
    token: `${jobId}.${expSeconds}.${sign(jobId, expSeconds, secret)}`,
    expiresAt: expSeconds * 1000,
  };
}

export function verifyLiveViewToken(
  token: string,
  jobId: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!secret || !token || !jobId) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokJob, expS, sig] = parts;
  if (tokJob !== jobId || !/^\d+$/.test(expS)) return false;
  const exp = Number(expS);
  if (Math.floor(now / 1000) >= exp) return false;
  const expected = sign(jobId, exp, secret);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
}
