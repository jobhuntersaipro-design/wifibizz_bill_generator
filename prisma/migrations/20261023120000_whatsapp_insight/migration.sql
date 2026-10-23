-- Claude's read of each chat: what the customer wants and how likely they sign up.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "intent" TEXT;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "signup_chance" INTEGER;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "insight_by" TEXT;

-- One row: the model that sorts chats. Null = WHATSAPP_CRM_MODEL, else Haiku 5.5.
CREATE TABLE "whatsapp_crm_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_crm_settings_pkey" PRIMARY KEY ("id")
);
