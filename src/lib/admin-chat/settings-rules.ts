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

export interface ChatModel {
  id: string;
  label: string;
  note: string;
  /** The effort levels this model accepts, of the ones the page offers. */
  efforts: ChatEffort[];
}

/** The chat route sends `max_tokens: 16000`; a model capped below that refuses every turn. */
export const CHAT_MAX_TOKENS = 16000;

/**
 * Price notes by model id. The Models API does not return pricing, so a model
 * not listed here shows a generic note rather than a guessed price.
 */
const MODEL_NOTES: Record<string, string> = {
  "claude-opus-5-5": "$4 / $20 per million tokens (in / out). Balanced.",
  "claude-sonnet-5-5": "$2 / $10. Faster and half the price.",
  "claude-fable-5-1": "$10 / $50. Most capable, slowest.",
};
const UNPRICED_NOTE = "Price not listed here — check Anthropic's pricing page.";

/**
 * The fallback list, used only when the live list from the Models API cannot
 * be read (no key, API down). Every entry is known to accept what the route sends.
 */
export const CHAT_MODELS: ChatModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: MODEL_NOTES["claude-opus-5-5"], efforts: ["low", "medium", "high"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: MODEL_NOTES["claude-sonnet-5-5"], efforts: ["low", "medium", "high"] },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: MODEL_NOTES["claude-fable-5-1"], efforts: ["low", "medium", "high"] },
];

/** The parts of a Models API entry the picker reads (a subset of the SDK's BetaModelInfo). */
export interface ApiModelInfo {
  id: string;
  display_name: string;
  created_at: string;
  max_tokens: number | null;
  allowed_fallback_models: string[] | null;
  capabilities: {
    effort: { supported: boolean } & Partial<Record<ChatEffort, { supported: boolean } | null>>;
    thinking: { types: { adaptive: { supported: boolean } } };
  } | null;
}

/**
 * Why the chat route cannot use a model, or null when it can. The route sends
 * adaptive thinking, `output_config.effort` and `fallbacks: "default"` on every
 * call, so a model missing any of them would turn every question into an error.
 * An empty `allowed_fallback_models` is the API's way of saying "no fallbacks".
 */
export function modelUnusableReason(m: ApiModelInfo): string | null {
  const c = m.capabilities;
  if (!c) return "capabilities not reported";
  if (!c.thinking?.types?.adaptive?.supported) return "no adaptive thinking";
  if (!c.effort?.supported) return "no effort setting";
  if (!m.allowed_fallback_models?.length) return "no refusal fallback";
  if (m.max_tokens !== null && m.max_tokens < CHAT_MAX_TOKENS) return `max output ${m.max_tokens} tokens`;
  return null;
}

/** Usable models from the API, newest release first. */
export function chatModelsFromApi(infos: readonly ApiModelInfo[]): ChatModel[] {
  return infos
    .filter((m) => modelUnusableReason(m) === null)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((m) => ({
      id: m.id,
      label: m.display_name,
      note: MODEL_NOTES[m.id] ?? UNPRICED_NOTE,
      efforts: CHAT_EFFORTS.map((e) => e.id).filter((e) => m.capabilities!.effort[e]?.supported),
    }));
}

/** A string shaped like an Anthropic model id — what a stored row may hold. */
const MODEL_ID = /^claude-[a-z0-9.-]{1,80}$/;

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
  models: readonly ChatModel[] = CHAT_MODELS,
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
  const picked = model === null ? null : models.find((m) => m.id === model);
  if (model !== null && !picked) {
    return { ok: false, error: `Unknown model "${model}".` };
  }
  const effort = input.effort || null;
  if (effort !== null && !CHAT_EFFORTS.some((e) => e.id === effort)) {
    return { ok: false, error: `Unknown effort "${effort}".` };
  }
  if (picked && effort !== null && !picked.efforts.includes(effort)) {
    return { ok: false, error: `${picked.label} does not accept effort "${effort}".` };
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
    // The offered list is live, so any id-shaped value is kept (it was checked
    // against that list when saved). Junk falls back to the deployment's choice.
    model: typeof row.model === "string" && MODEL_ID.test(row.model) ? row.model : null,
    effort: CHAT_EFFORTS.find((e) => e.id === row.effort)?.id ?? null,
  };
}
