/**
 * Admin AI chatbot settings. Read once per request from env so a Vercel env
 * change takes effect on the next deploy without code.
 *
 * The chatbot is a testing feature: OFF unless ADMIN_CHAT_ENABLED is "1".
 */

export type ChatEffort = "low" | "medium" | "high";

export const CHAT_LIMITS = {
  /** Characters per user message. */
  maxMessageChars: 1000,
  /** User messages per conversation. */
  maxUserTurns: 30,
  /** Model calls per reply (each tool round is one). */
  maxModelCalls: 8,
  /** Off-topic strikes before the conversation locks. */
  strikesToLock: 3,
  /** How long a lock lasts. */
  lockMs: 60 * 60 * 1000,
  /** Prior turns replayed to the model. Older ones are dropped, not summarised. */
  historyTurns: 20,
} as const;

const EFFORTS: ChatEffort[] = ["low", "medium", "high"];

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function chatConfig() {
  const effortRaw = (process.env.ADMIN_CHAT_EFFORT ?? "").trim() as ChatEffort;
  const handoffName = process.env.ADMIN_CHAT_HANDOFF_NAME?.trim() || "Sofie";
  return {
    enabled: process.env.ADMIN_CHAT_ENABLED === "1",
    apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
    model: process.env.ADMIN_CHAT_MODEL?.trim() || "claude-opus-5-5",
    effort: EFFORTS.includes(effortRaw) ? effortRaw : ("medium" as ChatEffort),
    dailyLimit: intEnv(process.env.ADMIN_CHAT_DAILY_LIMIT, 200),
    handoffName,
    // Placeholder address. Falls back to the stuck-lock alert address so a
    // handoff reaches SOMEONE before Sofie's real address is set.
    handoffEmail:
      process.env.ADMIN_CHAT_HANDOFF_EMAIL?.trim() || process.env.ADMIN_ALERT_EMAIL?.trim() || "",
  };
}
