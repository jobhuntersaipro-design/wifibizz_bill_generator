import { createChatDraft, json, refuseCaller } from "@/lib/chatbot-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refused = refuseCaller(req);
  if (refused) return refused;
  try {
    const res = await createChatDraft(await req.json().catch(() => null));
    return res.ok ? json(res.data) : json({ error: res.error }, res.status);
  } catch (e) {
    console.error("[chatbot/order-draft]", e);
    return json({ error: "Could not create the draft." }, 500);
  }
}
