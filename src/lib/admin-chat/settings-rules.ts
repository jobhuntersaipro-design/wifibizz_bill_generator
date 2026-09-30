/**
 * The assistant's admin-editable settings: pure rules only, so the settings
 * page (client) and the chat route (server) apply the exact same ones.
 *
 * "Nothing saved" and "saved as the defaults" behave identically: a null
 * `instructions` and an empty override map both mean "use the built-in".
 */

import { MAX_INSTRUCTIONS_CHARS } from "./prompt";
import type { ChatEffort } from "./config";

export const MIN_INSTRUCTIONS_CHARS = 50;
export const MIN_TOOL_DESCRIPTION_CHARS = 20;
export const MAX_TOOL_DESCRIPTION_CHARS = 2000;

/**
 * The models an admin may pick. Only models that accept everything the chat
 * route sends — adaptive thinking, `output_config.effort` and the
 * `fallbacks: "default"` refusal fallback — so a pick can never turn every
 * question into an API error. (Haiku 4.5 is left out for exactly that reason.)
 */
export const CHAT_MODELS: { id: string; label: string; note: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "$4 / $20 per million tokens (in / out). Balanced." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "$2 / $10. Faster and half the price." },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "$10 / $50. Most capable, slowest." },
];

export const CHAT_EFFORTS: { id: ChatEffort; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "Fastest, cheapest; fine for simple lookups." },
  { id: "medium", label: "Medium", note: "The default balance." },
  { id: "high", label: "High", note: "Thinks longer; better on tricky failure questions." },
];

export interface ChatSettings {
  /** Null = the built-in DEFAULT_INSTRUCTIONS. */
  instructions: string | null;
  /** Tool names the model is NOT offered and cannot run. */
  disabledTools: string[];
  /** Tool name → description the model reads instead of the built-in one. */
  toolDescriptions: Record<string, string>;
  /** Null = the deployment's ADMIN_CHAT_MODEL. */
  model: string | null;
  /** Null = the deployment's ADMIN_CHAT_EFFORT. */
  effort: ChatEffort | null;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  instructions: null,
  disabledTools: [],
  toolDescriptions: {},
  model: null,
  effort: null,
};

/** The model and effort a request actually uses: saved choice, else the deployment's. */
export function effectiveModel(
  settings: Pick<ChatSettings, "model" | "effort">,
  deployment: { model: string; effort: ChatEffort },
): { model: string; effort: ChatEffort } {
  return { model: settings.model ?? deployment.model, effort: settings.effort ?? deployment.effort };
}

/** Human names for the settings page, and what each tool is for. */
export const TOOL_LABELS: Record<string, { label: string; note?: string }> = {
  search_orders: { label: "Search orders" },
  get_order: { label: "Order detail" },
  explain_error_code: { label: "Explain an error code" },
  list_plans: { label: "Plans" },
  order_stats: { label: "Submit statistics" },
  live_jobs: { label: "Running jobs" },
  list_image_pools: { label: "Image pools" },
  escalate_to_human: {
    label: "Hand off to a person",
    note: "Records a handoff and e-mails the handoff person. Off = the assistant cannot hand anything off.",
  },
  flag_off_topic: {
    label: "Flag off-topic",
    note: "Records a strike; 3 strikes lock the chat for an hour. Off = nothing ever locks.",
  },
};

/**
 * Validate what the page sends. Returns the settings to store (defaults folded
 * back to null / absent, so saving the defaults is the same as never saving)
 * or the first problem.
 */
export function normalizeChatSettings(
  input: ChatSettings,
  knownTools: readonly { name: string; description: string }[],
  defaultInstructions: string,
): { ok: true; settings: ChatSettings } | { ok: false; error: string } {
  const known = new Map(knownTools.map((t) => [t.name, t.description]));

  let instructions: string | null = input.instructions?.replace(/\r\n/g, "\n").trim() || null;
  if (instructions !== null) {
    if (instructions.length < MIN_INSTRUCTIONS_CHARS) {
      return { ok: false, error: `Instructions are too short (at least ${MIN_INSTRUCTIONS_CHARS} characters). Reset to default instead of clearing them.` };
    }
    if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
      return { ok: false, error: `Instructions are too long (${instructions.length} of ${MAX_INSTRUCTIONS_CHARS} characters).` };
    }
    if (instructions === defaultInstructions.trim()) instructions = null;
  }

  const disabledTools: string[] = [];
  for (const name of input.disabledTools) {
    if (!known.has(name)) return { ok: false, error: `Unknown tool "${name}".` };
    if (!disabledTools.includes(name)) disabledTools.push(name);
  }
  disabledTools.sort();

  const toolDescriptions: Record<string, string> = {};
  for (const [name, raw] of Object.entries(input.toolDescriptions)) {
    const builtIn = known.get(name);
    if (builtIn === undefined) return { ok: false, error: `Unknown tool "${name}".` };
    const text = raw.replace(/\r\n/g, "\n").trim();
    if (!text || text === builtIn) continue;
    if (text.length < MIN_TOOL_DESCRIPTION_CHARS) {
      return { ok: false, error: `The description of ${name} is too short (at least ${MIN_TOOL_DESCRIPTION_CHARS} characters).` };
    }
    if (text.length > MAX_TOOL_DESCRIPTION_CHARS) {
      return { ok: false, error: `The description of ${name} is too long (${text.length} of ${MAX_TOOL_DESCRIPTION_CHARS} characters).` };
    }
    toolDescriptions[name] = text;
  }

  const model = input.model?.trim() || null;
  if (model !== null && !CHAT_MODELS.some((m) => m.id === model)) {
    return { ok: false, error: `Unknown model "${model}".` };
  }
  const effort = input.effort || null;
  if (effort !== null && !CHAT_EFFORTS.some((e) => e.id === effort)) {
    return { ok: false, error: `Unknown effort "${effort}".` };
  }

  return { ok: true, settings: { instructions, disabledTools, toolDescriptions, model, effort } };
}

/**
 * Tools the instructions tell the model to call but that are switched off —
 * the model will be told to use something it does not have. Shown as a
 * warning, never blocking: the admin may be mid-edit.
 */
export function disabledToolsNamedIn(instructions: string, disabledTools: readonly string[]): string[] {
  return disabledTools.filter((name) => new RegExp(`\\b${name}\\b`).test(instructions));
}

/** Coerce whatever the database row holds into settings, never throwing. */
export function chatSettingsFromRow(
  row: {
    instructions: string | null;
    disabledTools: string[];
    toolDescriptions: unknown;
    model?: string | null;
    effort?: string | null;
  } | null,
): ChatSettings {
  if (!row) return DEFAULT_CHAT_SETTINGS;
  const descriptions: Record<string, string> = {};
  if (row.toolDescriptions && typeof row.toolDescriptions === "object" && !Array.isArray(row.toolDescriptions)) {
    for (const [k, v] of Object.entries(row.toolDescriptions as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) descriptions[k] = v;
    }
  }
  return {
    instructions: row.instructions?.trim() ? row.instructions : null,
    disabledTools: Array.isArray(row.disabledTools) ? row.disabledTools : [],
    toolDescriptions: descriptions,
    // An id no longer offered (or a hand-edited row) falls back to the
    // deployment's choice rather than sending the API a model it may refuse.
    model: CHAT_MODELS.some((m) => m.id === row.model) ? row.model! : null,
    effort: CHAT_EFFORTS.find((e) => e.id === row.effort)?.id ?? null,
  };
}
