"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-gate";
import { ADMIN_ACTOR, recordAudit } from "@/lib/audit";
import { CHAT_TOOLS } from "@/lib/admin-chat/tools";
import { DEFAULT_INSTRUCTIONS } from "@/lib/admin-chat/prompt";
import { normalizeChatSettings, type ChatSettings } from "@/lib/admin-chat/settings-rules";
import { loadChatSettings } from "@/lib/admin-chat/settings";

/**
 * Save the assistant's instructions and tool settings. Admin-gated; validated
 * with the same rules the page shows. Takes effect on the next message — the
 * chat route reads the row on every request.
 */
export async function saveChatSettings(input: ChatSettings) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const shaped: ChatSettings = {
    instructions: typeof input?.instructions === "string" ? input.instructions : null,
    disabledTools: Array.isArray(input?.disabledTools)
      ? input.disabledTools.filter((n): n is string => typeof n === "string")
      : [],
    toolDescriptions:
      input?.toolDescriptions && typeof input.toolDescriptions === "object"
        ? Object.fromEntries(
            Object.entries(input.toolDescriptions).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : {},
  };
  const res = normalizeChatSettings(shaped, CHAT_TOOLS, DEFAULT_INSTRUCTIONS);
  if (!res.ok) return { success: false as const, error: res.error };

  try {
    const before = await loadChatSettings();
    const s = res.settings;
    await prisma.adminChatSettings.upsert({
      where: { id: 1 },
      create: { id: 1, instructions: s.instructions, disabledTools: s.disabledTools, toolDescriptions: s.toolDescriptions },
      update: { instructions: s.instructions, disabledTools: s.disabledTools, toolDescriptions: s.toolDescriptions },
    });

    // What changed, in words — never the prompt text itself.
    const changed: string[] = [];
    if (before.instructions !== s.instructions) {
      changed.push(s.instructions === null ? "instructions reset to default" : "instructions edited");
    }
    const off = s.disabledTools.filter((n) => !before.disabledTools.includes(n));
    const on = before.disabledTools.filter((n) => !s.disabledTools.includes(n));
    if (off.length) changed.push(`switched off ${off.join(", ")}`);
    if (on.length) changed.push(`switched on ${on.join(", ")}`);
    const descNames = new Set([...Object.keys(before.toolDescriptions), ...Object.keys(s.toolDescriptions)]);
    const descChanged = [...descNames].filter((n) => before.toolDescriptions[n] !== s.toolDescriptions[n]);
    if (descChanged.length) changed.push(`descriptions changed for ${descChanged.join(", ")}`);
    if (changed.length) {
      await recordAudit({ actor: ADMIN_ACTOR, action: "assistant_settings_updated", detail: `${changed.join("; ")}.` });
    }

    return { success: true as const, settings: s, changed: changed.length > 0 };
  } catch (e) {
    console.error("[saveChatSettings]", e);
    return { success: false as const, error: "Could not save the assistant settings." };
  }
}
