-- Claude auto-reply (Dualhook): per-chat switch, the reason it paused, and which replies the AI wrote.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "ai_paused_reason" TEXT;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "ai_paused_at" TIMESTAMP(3);
ALTER TABLE "whatsapp_messages" ADD COLUMN "by_ai" BOOLEAN NOT NULL DEFAULT false;

-- The knowledge document the AI answers from: text, or a PDF as base64.
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "knowledge_name" TEXT;
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "knowledge_mime" TEXT;
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "knowledge_doc" TEXT;
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "knowledge_updated_at" TIMESTAMP(3);

-- In-app alerts for the WhatsApp team (a customer sent documents).
CREATE TABLE "whatsapp_alerts" (
    "id" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMP(3),
    CONSTRAINT "whatsapp_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_alerts_created_at_idx" ON "whatsapp_alerts"("created_at");
