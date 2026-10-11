-- WhatsApp Coexistence spike. Additive only: one new table, no existing
-- table is read or written.
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" TEXT,
    "from_wa_id" TEXT,
    "to_wa_id" TEXT,
    "message_id" TEXT,
    "message_type" TEXT,
    "text_preview" TEXT,
    "raw_body" TEXT NOT NULL,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_webhook_events_received_at_idx" ON "whatsapp_webhook_events"("received_at");
