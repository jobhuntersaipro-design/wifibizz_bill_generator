import Anthropic from "@anthropic-ai/sdk";
import { chatConfig } from "./config";
import { CHAT_MODELS, chatModelsFromApi, type ApiModelInfo, type ChatModel } from "./settings-rules";

/**
 * The models the admin may pick, read live from Anthropic's Models API so a new
 * release shows up without a code change. NEVER throws: no key, an API error,
 * or an empty usable list all fall back to the built-in CHAT_MODELS.
 */

const TTL_MS = 60 * 60 * 1000;
// ponytail: per-instance memo, so each serverless instance asks once an hour. Fine at admin traffic.
let cache: { at: number; models: ChatModel[] } | null = null;

export async function listChatModels(): Promise<{ models: ChatModel[]; live: boolean }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { models: cache.models, live: true };
  const { apiKey } = chatConfig();
  if (!apiKey) return { models: CHAT_MODELS, live: false };
  try {
    const client = new Anthropic({ apiKey, authToken: null });
    const infos: ApiModelInfo[] = [];
    for await (const m of client.beta.models.list({ limit: 100 })) infos.push(m as ApiModelInfo);
    const models = chatModelsFromApi(infos);
    if (!models.length) return { models: CHAT_MODELS, live: false };
    cache = { at: Date.now(), models };
    return { models, live: true };
  } catch (e) {
    console.error("[admin-chat] could not list models, using the built-in list:", e);
    return { models: CHAT_MODELS, live: false };
  }
}
