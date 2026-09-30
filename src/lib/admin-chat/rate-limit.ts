import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * The chatbot's own limiter: 20 messages per 10 minutes per client.
 *
 * A separate instance from the sign-in limiter in `src/lib/rate-limit.ts`,
 * which is fixed at 5 per 15 minutes — far too tight for a conversation.
 *
 * Fails open like that one: an Upstash outage must not take the chat down.
 * The daily cap in the database is what bounds cost when this is unavailable.
 */

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(20, "10 m"),
    prefix: "ratelimit:admin-chat",
    timeout: 3000,
  });
  return limiter;
}

export async function checkChatRateLimit(key: string): Promise<{ ok: boolean; resetMs: number }> {
  const l = getLimiter();
  if (!l) return { ok: true, resetMs: 0 };
  try {
    const r = await l.limit(key);
    return { ok: r.success, resetMs: r.reset };
  } catch {
    return { ok: true, resetMs: 0 };
  }
}
