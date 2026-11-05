import { contactRecords, json, refuseCaller } from "@/lib/chatbot-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = refuseCaller(req);
  if (refused) return refused;
  const phones = new URL(req.url).searchParams.getAll("phone").filter((p) => /\d{6,}/.test(p));
  if (phones.length === 0) return json({ error: "Give at least one phone." }, 400);
  try {
    return json(await contactRecords(phones));
  } catch (e) {
    console.error("[chatbot/contact]", e);
    return json({ error: "Could not look up this number." }, 500);
  }
}
