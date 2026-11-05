import { attachChatDocument, json, MAX_DOCUMENT_BYTES, refuseCaller } from "@/lib/chatbot-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCaller(req);
  if (refused) return refused;
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES) return json({ error: "The file is larger than 4 MB." }, 413);
  try {
    const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    const res = await attachChatDocument(id, mime, Buffer.from(await req.arrayBuffer()));
    return res.ok ? json(res.data) : json({ error: res.error }, res.status);
  } catch (e) {
    console.error("[chatbot/order-draft/document]", e);
    return json({ error: "Could not attach the document." }, 500);
  }
}
