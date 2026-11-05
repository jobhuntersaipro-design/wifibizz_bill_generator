import { json, orderEntryAccounts, refuseCaller } from "@/lib/chatbot-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = refuseCaller(req);
  if (refused) return refused;
  try {
    return json({ accounts: await orderEntryAccounts() });
  } catch (e) {
    console.error("[chatbot/accounts]", e);
    return json({ error: "Could not load the accounts." }, 500);
  }
}
