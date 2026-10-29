-- A name the admin typed for a contact; wins over the WhatsApp profile name.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "display_name" TEXT;

-- Coexistence history import: Meta's latest progress (0-100) and when it arrived.
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "history_progress" INTEGER;
ALTER TABLE "whatsapp_crm_settings" ADD COLUMN "history_at" TIMESTAMP(3);
