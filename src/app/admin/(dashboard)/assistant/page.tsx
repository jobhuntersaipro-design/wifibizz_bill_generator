import { z } from "zod";
import { AssistantSettings, type ToolInfo } from "@/components/admin/assistant-settings";
import { CHAT_TOOLS } from "@/lib/admin-chat/tools";
import { chatConfig } from "@/lib/admin-chat/config";
import { loadChatSettings } from "@/lib/admin-chat/settings";
import { TOOL_LABELS } from "@/lib/admin-chat/settings-rules";

export const dynamic = "force-dynamic";

/** A tool's inputs, read off its schema, so the page cannot describe inputs the code does not take. */
function toolInputs(schema: z.ZodType): ToolInfo["inputs"] {
  const json = z.toJSONSchema(schema) as { properties?: Record<string, { description?: string }> };
  return Object.entries(json.properties ?? {}).map(([name, p]) => ({ name, description: p.description ?? null }));
}

export default async function AdminAssistantPage() {
  const cfg = chatConfig();
  const settings = await loadChatSettings();
  const tools: ToolInfo[] = CHAT_TOOLS.map((t) => ({
    name: t.name,
    label: TOOL_LABELS[t.name]?.label ?? t.name,
    note: TOOL_LABELS[t.name]?.note ?? null,
    defaultDescription: t.description,
    inputs: toolInputs(t.schema),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Assistant</h1>
        <p className="text-sm text-[#697386] mt-1">
          What the admin assistant is told, and which lookups it may use. Changes apply to the next message.
        </p>
      </div>
      <AssistantSettings
        initial={settings}
        tools={tools}
        runtime={{
          enabled: cfg.enabled,
          model: cfg.model,
          effort: cfg.effort,
          handoffName: cfg.handoffName,
        }}
      />
    </div>
  );
}
