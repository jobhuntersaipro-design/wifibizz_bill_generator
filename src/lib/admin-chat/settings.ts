import { prisma } from "@/lib/prisma";
import { chatSettingsFromRow, DEFAULT_CHAT_SETTINGS, type ChatSettings } from "./settings-rules";

/**
 * Read the assistant's saved settings. NEVER throws: an unreadable row (or a
 * database that has not had the migration yet) falls back to the built-in
 * defaults, so a settings problem cannot take the assistant down.
 */
export async function loadChatSettings(): Promise<ChatSettings> {
  try {
    const row = await prisma.adminChatSettings.findUnique({ where: { id: 1 } });
    return chatSettingsFromRow(row);
  } catch (e) {
    console.error("[admin-chat] could not read settings, using defaults:", e);
    return DEFAULT_CHAT_SETTINGS;
  }
}
