-- Admin WhatsApp inbox: per-chat open/closed and shared read state.
-- Additive only.
CREATE TABLE "whatsapp_conversations" (
    "wa_id" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "last_read_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("wa_id")
);
