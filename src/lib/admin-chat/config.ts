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

/**
 * The key as pasted into Vercel, minus what a paste commonly adds: surrounding
 * whitespace and quotes. A quoted key is sent verbatim and the API answers 401.
 */
export function cleanApiKey(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

/**
 * Why a key cannot work, judged from its prefix alone — never echoes the key.
 * Only the two known wrong kinds are refused; an unfamiliar prefix is let
 * through so a future key format is not blocked by this check.
 */
export function apiKeyProblem(key: string): string | null {
  if (!key) return "ANTHROPIC_API_KEY is not set.";
  if (key.startsWith("sk-ant-admin")) {
    return "ANTHROPIC_API_KEY is an Admin API key (sk-ant-admin…), which cannot send messages. Create a regular API key (sk-ant-api…) in the Claude Console.";
  }
  if (key.startsWith("sk-ant-oat")) {
    return "ANTHROPIC_API_KEY is an OAuth token (sk-ant-oat…), not an API key. Create an API key (sk-ant-api…) in the Claude Console.";
  }
  return null;
}

export function chatConfig() {
  const effortRaw = (process.env.ADMIN_CHAT_EFFORT ?? "").trim() as ChatEffort;
  const handoffName = process.env.ADMIN_CHAT_HANDOFF_NAME?.trim() || "Sofie";
  return {
    enabled: process.env.ADMIN_CHAT_ENABLED === "1",
    apiKey: cleanApiKey(process.env.ANTHROPIC_API_KEY),
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
